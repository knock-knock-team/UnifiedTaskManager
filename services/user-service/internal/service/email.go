package service

import (
	"fmt"
	"html"
	"mime"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

type EmailSender interface {
	SendRegistrationCode(email, name, code string) error
}

type NoopEmailSender struct{}

func (NoopEmailSender) SendRegistrationCode(_, _, _ string) error {
	return nil
}

type SMTPEmailSender struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
	FromName string
}

func (s SMTPEmailSender) SendRegistrationCode(email, name, code string) error {
	host := strings.TrimSpace(s.Host)
	port := strings.TrimSpace(s.Port)
	username := strings.TrimSpace(s.Username)
	password := strings.TrimSpace(s.Password)
	from := strings.TrimSpace(s.From)
	if host == "" || port == "" || username == "" || password == "" || from == "" {
		return ErrEmailUnavailable
	}
	to := strings.TrimSpace(email)
	if to == "" {
		return ErrBadRequest
	}
	displayName := strings.TrimSpace(name)
	if displayName == "" {
		displayName = "пользователь"
	}
	fromName := strings.TrimSpace(s.FromName)
	if fromName == "" {
		fromName = "UnifiedTaskManager"
	}
	subject := "Код подтверждения регистрации в UnifiedTaskManager"
	textBody := fmt.Sprintf("Здравствуйте, %s!\n\nВаш код подтверждения регистрации: %s\n\nКод действует 10 минут. Если вы не регистрировались в UnifiedTaskManager, просто проигнорируйте это письмо.\n", displayName, code)
	htmlBody := registrationCodeHTML(displayName, code)
	messageIDDomain := host
	if at := strings.LastIndex(from, "@"); at >= 0 && at+1 < len(from) {
		messageIDDomain = from[at+1:]
	}
	boundary := fmt.Sprintf("utm-registration-%d", time.Now().UnixNano())
	message := strings.Join([]string{
		fmt.Sprintf("From: %s", (&mail.Address{Name: fromName, Address: from}).String()),
		fmt.Sprintf("To: %s", to),
		fmt.Sprintf("Subject: %s", mime.QEncoding.Encode("UTF-8", subject)),
		fmt.Sprintf("Date: %s", time.Now().Format(time.RFC1123Z)),
		fmt.Sprintf("Message-ID: <%d@%s>", time.Now().UnixNano(), messageIDDomain),
		"MIME-Version: 1.0",
		fmt.Sprintf("Content-Type: multipart/alternative; boundary=%q", boundary),
		"",
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		textBody,
		fmt.Sprintf("--%s", boundary),
		"Content-Type: text/html; charset=UTF-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		htmlBody,
		fmt.Sprintf("--%s--", boundary),
	}, "\r\n")

	auth := smtp.PlainAuth("", username, password, host)
	return smtp.SendMail(host+":"+port, auth, from, []string{to}, []byte(message))
}

func registrationCodeHTML(displayName, code string) string {
	safeName := html.EscapeString(displayName)
	safeCode := html.EscapeString(code)
	digits := strings.Split(safeCode, "")
	codeCells := make([]string, 0, len(digits))
	for _, digit := range digits {
		codeCells = append(codeCells, fmt.Sprintf(`<td style="width:42px;height:52px;border-radius:14px;background:#101826;border:1px solid #2d3b52;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:700;color:#f7fbff;">%s</td>`, digit))
	}
	return fmt.Sprintf(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Код подтверждения UnifiedTaskManager</title>
  </head>
  <body style="margin:0;padding:0;background:#07111f;font-family:Arial,Helvetica,sans-serif;color:#e7edf6;">
    <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="background:#07111f;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:560px;border-radius:26px;overflow:hidden;background:#0b1220;border:1px solid #1f2a3a;box-shadow:0 24px 80px rgba(0,0,0,0.34);">
            <tr>
              <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#1c2a44,#102019);">
                <div style="display:inline-block;padding:7px 11px;border-radius:999px;background:rgba(126,168,255,0.16);border:1px solid rgba(126,168,255,0.35);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#cfe0ff;">UnifiedTaskManager</div>
                <h1 style="margin:18px 0 8px;font-size:28px;line-height:1.15;color:#ffffff;">Подтвердите регистрацию</h1>
                <p style="margin:0;color:#c9d4e4;font-size:15px;line-height:1.6;">Здравствуйте, %s! Введите этот код на странице регистрации, чтобы продолжить создание аккаунта.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 14px;color:#93a4bb;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;">Код подтверждения</p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="border-spacing:8px;margin:0 0 22px -8px;">
                  <tr>%s</tr>
                </table>
                <div style="border-radius:18px;background:#0f1726;border:1px solid #233248;padding:16px 18px;margin-bottom:20px;">
                  <p style="margin:0;color:#dce7f5;font-size:14px;line-height:1.55;">Код действует <strong style="color:#ffffff;">10 минут</strong>. Если письмо пришло не сразу, проверьте папку «Спам» или запросите новый код через 2 минуты.</p>
                </div>
                <p style="margin:0;color:#8ea0b7;font-size:13px;line-height:1.55;">Если вы не регистрировались в UnifiedTaskManager, просто проигнорируйте это письмо. Никому не сообщайте код подтверждения.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;border-top:1px solid #1f2a3a;color:#71829a;font-size:12px;line-height:1.5;">
                Это автоматическое письмо сервиса UnifiedTaskManager. Отвечать на него не нужно.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`, safeName, strings.Join(codeCells, ""))
}
