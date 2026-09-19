export type Member = {
    id: string;
    user_id: string;
    name: string;
    email: string;
    avatar: string;
    role: string;
    is_owner: boolean;
    created_at: string;
};

export type Invitation = {
    id: string;
    email: string;
    role: string;
    invited_by: string | null;
    expires_at: string;
    created_at: string;
};
