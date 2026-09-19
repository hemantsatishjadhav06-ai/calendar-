export type PublicTarget = {
    platform: 'x' | 'bluesky' | 'linkedin';
    sections: string[];
    status: string; // 'pending'|'publishing'|'published'|'failed'|'deleting'|'deleted'
    handle: string | null;
    display_name: string | null;
    avatar_url: string | null;
};

export type PublicMedia = {
    id: string;
    url: string;
    mime: string;
    alt_text: string | null;
};

export type PublicPostView = {
    base_text: string;
    status: string; // 'draft'|'scheduled'|'publishing'|'published'|'partial'|'failed'|'deleted'
    scheduled_at: string | null; // ISO
    created_at: string; // ISO
    targets: PublicTarget[];
    media: PublicMedia[];
};
