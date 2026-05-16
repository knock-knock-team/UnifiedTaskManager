package service

import "testing"

func TestTaskETagAndColumnETag(t *testing.T) {
	if TaskETag(7) != `"7"` {
		t.Fatalf("TaskETag: got %s", TaskETag(7))
	}
	if ColumnETag(12) != `"12"` {
		t.Fatalf("ColumnETag: got %s", ColumnETag(12))
	}
}

func TestParseIfMatchHeader(t *testing.T) {
	tests := []struct {
		name    string
		header  string
		version int64
		ok      bool
	}{
		{name: "empty", header: "", ok: false},
		{name: "wildcard", header: "*", ok: false},
		{name: "quoted", header: `"42"`, version: 42, ok: true},
		{name: "weak", header: `W/"9"`, version: 9, ok: true},
		{name: "unquoted", header: "3", version: 3, ok: true},
		{name: "spaces", header: `  "15"  `, version: 15, ok: true},
		{name: "zero", header: `"0"`, ok: false},
		{name: "negative", header: `"-1"`, ok: false},
		{name: "not a number", header: `"abc"`, ok: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			version, ok := ParseIfMatchHeader(tc.header)
			if ok != tc.ok {
				t.Fatalf("ok: got %v want %v", ok, tc.ok)
			}
			if ok && version != tc.version {
				t.Fatalf("version: got %d want %d", version, tc.version)
			}
		})
	}
}
