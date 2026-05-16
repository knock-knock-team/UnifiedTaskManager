package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

// incomingMsg represents messages received from clients
type incomingMsg struct {
	Type    string          `json:"type"`
	CallID  string          `json:"call_id,omitempty"`
	From    string          `json:"from,omitempty"`
	To      string          `json:"to,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// outgoingMsg represents messages sent to clients
type outgoingMsg struct {
	Type    string      `json:"type"`
	CallID  string      `json:"call_id,omitempty"`
	From    string      `json:"from,omitempty"`
	To      string      `json:"to,omitempty"`
	Payload interface{} `json:"payload,omitempty"`
}

type sdpPayload struct {
	SDP  string `json:"sdp"`
	Type string `json:"type"`
}

type icePayload struct {
	Candidate     string `json:"candidate"`
	SDPMid        string `json:"sdpMid"`
	SDPMLineIndex uint16 `json:"sdpMLineIndex"`
}

type callSession struct {
	ID          string              `json:"id"`
	InitiatorID string              `json:"initiator_id"`
	CreatedAt   string              `json:"created_at,omitempty"`
	EndedAt     string              `json:"ended_at,omitempty"`
	Status      string              `json:"status,omitempty"`
	ICEServers  []map[string]string `json:"ice_servers,omitempty"`
}

type publishedTrack struct {
	publisherID string
	trackID     string
	streamID    string
	kind        string
	local       *webrtc.TrackLocalStaticRTP
}

type claims struct {
	Subject   string `json:"sub"`
	TokenType string `json:"typ"`
	ExpiresAt int64  `json:"exp"`
}

// Room holds peers and coordinates forwarding
type Room struct {
	id     string
	mu     sync.Mutex
	peers  map[string]*Peer
	tracks []*publishedTrack
}

// Peer represents a websocket + PeerConnection client
type Peer struct {
	id              string
	conn            *websocket.Conn
	pc              *webrtc.PeerConnection
	room            *Room
	send            chan outgoingMsg
	mu              sync.Mutex
	remoteDescSet   bool
	pendingICEQueue []webrtc.ICECandidateInit
}

var (
	rooms   = make(map[string]*Room)
	roomsMu sync.Mutex

	calls   = make(map[string]*callSession)
	callsMu sync.Mutex
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

func getRoom(id string) *Room {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	r := rooms[id]
	if r == nil {
		r = &Room{id: id, peers: make(map[string]*Peer), tracks: make([]*publishedTrack, 0)}
		rooms[id] = r
	}
	return r
}

func defaultICEServers() []map[string]string {
	servers := []map[string]string{
		{"urls": "stun:stun.l.google.com:19302"},
		{"urls": "stun:stun1.l.google.com:19302"},
	}

	turnURL := strings.TrimSpace(os.Getenv("VITE_TURN_URL"))
	if turnURL == "" {
		turnURL = strings.TrimSpace(os.Getenv("TURN_URL"))
	}
	if turnURL == "" {
		return servers
	}

	turnServer := map[string]string{"urls": turnURL}
	if user := strings.TrimSpace(os.Getenv("VITE_TURN_USERNAME")); user != "" {
		turnServer["username"] = user
	}
	if cred := strings.TrimSpace(os.Getenv("VITE_TURN_CREDENTIAL")); cred != "" {
		turnServer["credential"] = cred
	}
	servers = append(servers, turnServer)
	return servers
}

func makeCallID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 12)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func userIDFromRequest(r *http.Request) string {
	userID := strings.TrimSpace(r.Header.Get("X-Gateway-User-Id"))
	if userID != "" {
		return userID
	}
	userID = strings.TrimSpace(r.Header.Get("X-User-Id"))
	if userID != "" {
		return userID
	}
	return strings.TrimSpace(r.URL.Query().Get("user_id"))
}

func writeJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}

func parseAccessToken(token, secret string) (*claims, error) {
	if strings.TrimSpace(token) == "" || strings.TrimSpace(secret) == "" {
		return nil, errors.New("missing token or secret")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}
	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return nil, errors.New("invalid token signature")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, errors.New("invalid token payload")
	}
	parsed := &claims{}
	if err := json.Unmarshal(payloadBytes, parsed); err != nil {
		return nil, errors.New("invalid token claims")
	}
	if parsed.TokenType != "access" || parsed.Subject == "" || parsed.ExpiresAt <= time.Now().Unix() {
		return nil, errors.New("token is expired or malformed")
	}
	return parsed, nil
}

func bearerToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[len("Bearer "):])
	}
	return ""
}

func authenticateRequest(r *http.Request) (*claims, error) {
	token := bearerToken(r)
	if token == "" {
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	return parseAccessToken(token, strings.TrimSpace(os.Getenv("JWT_SECRET")))
}

func handleCreateCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
		return
	}
	_, _ = io.Copy(io.Discard, r.Body)
	_ = r.Body.Close()

	authClaims, err := authenticateRequest(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "unauthorized"})
		return
	}

	initiatorID := authClaims.Subject
	if headerUser := userIDFromRequest(r); headerUser != "" && headerUser != initiatorID {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "user mismatch"})
		return
	}

	session := &callSession{
		ID:          makeCallID(),
		InitiatorID: initiatorID,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
		Status:      "active",
		ICEServers:  defaultICEServers(),
	}

	callsMu.Lock()
	calls[session.ID] = session
	callsMu.Unlock()

	writeJSON(w, http.StatusOK, session)
}

func handleCallAction(w http.ResponseWriter, r *http.Request) {
	authClaims, err := authenticateRequest(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "unauthorized"})
		return
	}
	if headerUser := userIDFromRequest(r); headerUser != "" && headerUser != authClaims.Subject {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "user mismatch"})
		return
	}

	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/calls/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "not found"})
		return
	}
	callID, action := parts[0], parts[1]

	callsMu.Lock()
	session := calls[callID]
	callsMu.Unlock()

	if session == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "call not found"})
		return
	}

	switch action {
	case "join":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
			return
		}
		if session.Status == "ended" {
			writeJSON(w, http.StatusGone, map[string]string{"message": "call ended"})
			return
		}
		writeJSON(w, http.StatusOK, session)
	case "end":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"message": "method not allowed"})
			return
		}
		callsMu.Lock()
		session.Status = "ended"
		session.EndedAt = time.Now().UTC().Format(time.RFC3339)
		callsMu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "ended", "id": callID})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "not found"})
	}
}

func (r *Room) addPeer(p *Peer) {
	r.mu.Lock()
	var prevPeer *Peer
	if existing := r.peers[p.id]; existing != nil && existing != p {
		prevPeer = existing
	}
	r.peers[p.id] = p
	// capture peers snapshot
	peersSnapshot := make([]*Peer, 0, len(r.peers))
	for _, v := range r.peers {
		peersSnapshot = append(peersSnapshot, v)
	}
	publishedSnapshot := make([]*publishedTrack, len(r.tracks))
	copy(publishedSnapshot, r.tracks)
	r.mu.Unlock()

	// If the same user reconnects, terminate the stale websocket session.
	if prevPeer != nil {
		select {
		case prevPeer.send <- outgoingMsg{
			Type:   "error",
			CallID: r.id,
			From:   "sfu",
			To:     prevPeer.id,
			Payload: map[string]string{
				"message": "another session connected for this user",
				"code":    "session_replaced",
			},
		}:
		default:
		}
		_ = prevPeer.conn.Close()
	}

	// Notify others about new participant
	for _, other := range peersSnapshot {
		if other.id == p.id {
			continue
		}
		other.send <- outgoingMsg{Type: "participant-joined", CallID: r.id, From: p.id}
		// Also send 'ready' so initiators will create offers (keeps compatibility with existing frontend)
		other.send <- outgoingMsg{Type: "ready", CallID: r.id, From: p.id}
	}

	// Backfill already published tracks for the new participant.
	// Without this, a late joiner can remain "alone" until others renegotiate.
	if len(publishedSnapshot) == 0 {
		return
	}

	for _, pub := range publishedSnapshot {
		p.send <- outgoingMsg{
			Type:   "track-added",
			CallID: r.id,
			From:   pub.publisherID,
			Payload: map[string]interface{}{
				"trackId":  pub.trackID,
				"streamId": pub.streamID,
				"kind":     pub.kind,
			},
		}
		sender, err := p.pc.AddTrack(pub.local)
		if err != nil {
			log.Printf("AddTrack(backfill) failed for subscriber %s: %v", p.id, err)
			continue
		}
		go func(s *webrtc.RTPSender) {
			rtcpBuf := make([]byte, 1500)
			for {
				if _, _, rtcpErr := s.Read(rtcpBuf); rtcpErr != nil {
					return
				}
			}
		}(sender)
	}

	offer, err := p.pc.CreateOffer(nil)
	if err != nil {
		log.Printf("CreateOffer(backfill) failed for %s: %v", p.id, err)
		return
	}
	if err := p.pc.SetLocalDescription(offer); err != nil {
		log.Printf("SetLocalDescription(backfill) failed for %s: %v", p.id, err)
		return
	}
	gatherComplete := webrtc.GatheringCompletePromise(p.pc)
	<-gatherComplete
	localDesc := p.pc.LocalDescription()
	backfillTracks := make([]map[string]interface{}, 0, len(publishedSnapshot))
	for _, pub := range publishedSnapshot {
		backfillTracks = append(backfillTracks, map[string]interface{}{
			"publisher": pub.publisherID,
			"track_id":  pub.trackID,
			"kind":      pub.kind,
			"stream_id": pub.streamID,
		})
	}
	p.send <- outgoingMsg{
		Type:   "offer",
		CallID: r.id,
		From:   "sfu",
		To:     p.id,
		Payload: map[string]interface{}{
			"sdp":    localDesc.SDP,
			"type":   localDesc.Type.String(),
			"tracks": backfillTracks,
		},
	}
}

func (p *Peer) markRemoteDescriptionSet() {
	p.mu.Lock()
	p.remoteDescSet = true
	queued := make([]webrtc.ICECandidateInit, len(p.pendingICEQueue))
	copy(queued, p.pendingICEQueue)
	p.pendingICEQueue = nil
	p.mu.Unlock()

	for _, cand := range queued {
		if err := p.pc.AddICECandidate(cand); err != nil {
			log.Printf("AddICECandidate(flush) failed: %v", err)
		}
	}
}

func (p *Peer) addOrQueueICECandidate(cand webrtc.ICECandidateInit) {
	p.mu.Lock()
	if !p.remoteDescSet {
		p.pendingICEQueue = append(p.pendingICEQueue, cand)
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()
	if err := p.pc.AddICECandidate(cand); err != nil {
		log.Printf("AddICECandidate failed: %v", err)
	}
}

func (r *Room) removePeer(p *Peer) {
	r.mu.Lock()
	delete(r.peers, p.id)
	filteredTracks := make([]*publishedTrack, 0, len(r.tracks))
	for _, tr := range r.tracks {
		if tr.publisherID != p.id {
			filteredTracks = append(filteredTracks, tr)
		}
	}
	r.tracks = filteredTracks
	peersSnapshot := make([]*Peer, 0, len(r.peers))
	for _, v := range r.peers {
		peersSnapshot = append(peersSnapshot, v)
	}
	r.mu.Unlock()

	for _, other := range peersSnapshot {
		other.send <- outgoingMsg{Type: "participant-left", CallID: r.id, From: p.id}
	}
}

// publishTrack forwards incoming track to other peers in the room
func (r *Room) publishTrack(pub *Peer, track *webrtc.TrackRemote, recv *webrtc.RTPReceiver) {
	log.Printf("Room %s: publishing track %s from %s kind=%s", r.id, track.ID(), pub.id, track.Kind().String())

	// Create a local track that we can add to other peers
	local, err := webrtc.NewTrackLocalStaticRTP(track.Codec().RTPCodecCapability, track.ID(), track.StreamID())
	if err != nil {
		log.Printf("failed to create local track: %v", err)
		return
	}

	// Add to all subscribers (other peers)
	r.mu.Lock()
	r.tracks = append(r.tracks, &publishedTrack{
		publisherID: pub.id,
		trackID:     track.ID(),
		streamID:    track.StreamID(),
		kind:        track.Kind().String(),
		local:       local,
	})
	subs := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		if p.id == pub.id {
			continue
		}
		subs = append(subs, p)
	}
	r.mu.Unlock()

	for _, sub := range subs {
		// Notify subscriber that a new track will be added from publisher
		sub.send <- outgoingMsg{Type: "track-added", CallID: r.id, From: pub.id, Payload: map[string]interface{}{"trackId": track.ID(), "streamId": track.StreamID(), "kind": track.Kind().String()}}

		sender, err := sub.pc.AddTrack(local)
		if err != nil {
			log.Printf("AddTrack failed for subscriber %s: %v", sub.id, err)
			continue
		}
		// Read RTCP from the sender to keep the pipeline healthy
		go func(s *webrtc.RTPSender) {
			rtcpBuf := make([]byte, 1500)
			for {
				if _, _, rtcpErr := s.Read(rtcpBuf); rtcpErr != nil {
					return
				}
			}
		}(sender)
	}

	// Copy RTP packets from remote track into the local track
	go func() {
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				log.Printf("track read ended: %v", err)
				return
			}
			if err := local.WriteRTP(pkt); err != nil {
				log.Printf("local.WriteRTP error: %v", err)
				return
			}
		}
	}()

	// Now renegotiate each subscriber so they receive the new m-line
	for _, sub := range subs {
		offer, err := sub.pc.CreateOffer(nil)
		if err != nil {
			log.Printf("CreateOffer failed for %s: %v", sub.id, err)
			continue
		}
		if err := sub.pc.SetLocalDescription(offer); err != nil {
			log.Printf("SetLocalDescription failed for %s: %v", sub.id, err)
			continue
		}
		// Wait for ICE gathering
		gatherComplete := webrtc.GatheringCompletePromise(sub.pc)
		<-gatherComplete
		localDesc := sub.pc.LocalDescription()
		// include track metadata so subscribers can map incoming tracks to publishers
		tracksMeta := []map[string]interface{}{{
			"publisher": pub.id,
			"track_id":  track.ID(),
			"kind":      track.Kind().String(),
			"stream_id": track.StreamID(),
		}}
		payload := map[string]interface{}{"sdp": localDesc.SDP, "type": localDesc.Type.String(), "tracks": tracksMeta}
		sub.send <- outgoingMsg{Type: "offer", CallID: r.id, From: "sfu", To: sub.id, Payload: payload}
	}
}

func wsSFUHandler(w http.ResponseWriter, r *http.Request) {
	authClaims, err := authenticateRequest(r)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade error: %v", err)
		return
	}

	// Create a new PeerConnection per websocket connection
	iceURL := os.Getenv("VITE_TURN_URL")
	iceUsername := os.Getenv("VITE_TURN_USERNAME")
	iceCred := os.Getenv("VITE_TURN_CREDENTIAL")

	config := webrtc.Configuration{}
	if iceURL != "" {
		config.ICEServers = []webrtc.ICEServer{{
			URLs:       []string{iceURL},
			Username:   iceUsername,
			Credential: iceCred,
		}}
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Printf("failed create pc: %v", err)
		conn.Close()
		return
	}

	peer := &Peer{
		id:              authClaims.Subject,
		conn:            conn,
		pc:              pc,
		send:            make(chan outgoingMsg, 16),
		pendingICEQueue: make([]webrtc.ICECandidateInit, 0, 8),
	}

	// Relay ICE candidates to client
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		cand := c.ToJSON()
		peer.send <- outgoingMsg{Type: "ice-candidate", Payload: map[string]interface{}{"candidate": cand.Candidate, "sdpMid": cand.SDPMid, "sdpMLineIndex": cand.SDPMLineIndex}}
	})

	// When the remote adds a track, publish it to other peers
	pc.OnTrack(func(track *webrtc.TrackRemote, recv *webrtc.RTPReceiver) {
		if peer.room == nil {
			log.Printf("OnTrack: no room for peer %s", peer.id)
			return
		}
		peer.room.publishTrack(peer, track, recv)
	})

	// Start write pump
	go func() {
		for msg := range peer.send {
			if err := peer.conn.WriteJSON(msg); err != nil {
				return
			}
		}
	}()

	// Read loop
	for {
		var im incomingMsg
		if err := conn.ReadJSON(&im); err != nil {
			log.Printf("ws read error: %v", err)
			break
		}

		switch im.Type {
		case "join":
			// Register peer into room
			callID := im.CallID
			if callID == "" {
				log.Printf("join missing call_id")
				continue
			}
			if im.From != "" && im.From != authClaims.Subject {
				log.Printf("join user mismatch: from=%s token-sub=%s", im.From, authClaims.Subject)
				peer.send <- outgoingMsg{Type: "error", CallID: callID, Payload: map[string]string{"message": "user mismatch"}}
				goto done
			}
			callsMu.Lock()
			session := calls[callID]
			callsMu.Unlock()
			if session == nil || session.Status == "ended" {
				peer.send <- outgoingMsg{Type: "error", CallID: callID, Payload: map[string]string{"message": "call unavailable"}}
				goto done
			}
			peer.id = authClaims.Subject
			room := getRoom(callID)
			peer.room = room
			room.addPeer(peer)

		case "offer":
			var s sdpPayload
			if err := json.Unmarshal(im.Payload, &s); err != nil {
				log.Printf("invalid offer payload: %v", err)
				continue
			}
			offer := webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: s.SDP}
			if err := peer.pc.SetRemoteDescription(offer); err != nil {
				log.Printf("SetRemoteDescription failed: %v", err)
				continue
			}
			peer.markRemoteDescriptionSet()

			// Create answer back to the same client
			answer, err := peer.pc.CreateAnswer(nil)
			if err != nil {
				log.Printf("CreateAnswer failed: %v", err)
				continue
			}
			if err := peer.pc.SetLocalDescription(answer); err != nil {
				log.Printf("SetLocalDescription failed: %v", err)
				continue
			}
			gatherComplete := webrtc.GatheringCompletePromise(peer.pc)
			<-gatherComplete

			localDesc := peer.pc.LocalDescription()
			payload := map[string]interface{}{"sdp": localDesc.SDP, "type": localDesc.Type.String()}
			peer.send <- outgoingMsg{Type: "answer", CallID: im.CallID, From: "sfu", To: im.From, Payload: payload}

		case "answer":
			var s sdpPayload
			if err := json.Unmarshal(im.Payload, &s); err != nil {
				log.Printf("invalid answer payload: %v", err)
				continue
			}
			answer := webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: s.SDP}
			if err := peer.pc.SetRemoteDescription(answer); err != nil {
				log.Printf("SetRemoteDescription(answer) failed: %v", err)
				continue
			}
			peer.markRemoteDescriptionSet()

		case "ice-candidate", "ice_candidate":
			var ic icePayload
			if err := json.Unmarshal(im.Payload, &ic); err != nil {
				log.Printf("invalid ice payload: %v", err)
				continue
			}
			if ic.Candidate == "" {
				continue
			}
			cand := webrtc.ICECandidateInit{Candidate: ic.Candidate, SDPMid: &ic.SDPMid, SDPMLineIndex: &ic.SDPMLineIndex}
			peer.addOrQueueICECandidate(cand)

		case "end":
			// Client asked to leave
			if peer.room != nil {
				peer.room.removePeer(peer)
			}
			goto done

		default:
			log.Printf("unknown ws message type: %s", im.Type)
		}
	}

done:
	// Cleanup
	if peer.room != nil {
		peer.room.removePeer(peer)
	}
	close(peer.send)
	peer.pc.Close()
	peer.conn.Close()
}

func main() {
	// Handle WebSocket paths under /ws/ to be compatible with previous call-service
	http.HandleFunc("/ws/", wsSFUHandler)
	http.HandleFunc("/ws", wsSFUHandler)
	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	http.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
	http.HandleFunc("/calls", handleCreateCall)
	http.HandleFunc("/calls/", handleCallAction)

	addr := ":8086"
	if a := os.Getenv("SFU_ADDR"); a != "" {
		addr = a
	}

	fmt.Printf("SFU signaling listening on %s\n", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("listen error: %v", err)
	}
}
