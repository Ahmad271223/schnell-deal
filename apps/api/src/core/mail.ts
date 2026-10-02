import nodemailer from 'nodemailer';
import { config } from '../config';

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  // Verbindungen wiederverwenden: Ein Rückstau an Benachrichtigungen wird so deutlich schneller abgearbeitet.
  // In Tests aus, damit keine offenen Verbindungen das Beenden verzögern.
  pool: config.NODE_ENV !== 'test',
  maxConnections: 3,
});

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Wird ausschließlich vom Worker (Job `email.send`) aufgerufen. Fehler → Retry durch die Queue. */
export async function sendMail(msg: MailMessage): Promise<void> {
  await transport.sendMail({
    from: config.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: `${msg.text}\n\n—\nDiese Nachricht wurde automatisch von der Plattform versendet.\n${config.PUBLIC_WEB_URL}`,
  });
}
