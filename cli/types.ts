export interface Attachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
}

export interface Email {
  id: string;
  subject?: string | null;
  sender?: string | null;
  recipient?: string | null;
  date?: string | null;
  received_at?: string | null;
  read?: boolean | number;
  starred?: boolean | number;
  snippet?: string | null;
  body?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  attachments?: Attachment[];
}

export interface EmailPage {
  emails: Email[];
  totalCount: number | null;
}
