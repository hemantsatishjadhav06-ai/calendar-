import { mail } from '@cadence/mail';
export const sendMail = (m: Parameters<typeof mail.send>[0]) => mail.send(m);
