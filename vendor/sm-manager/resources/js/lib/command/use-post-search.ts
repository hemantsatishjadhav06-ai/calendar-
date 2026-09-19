import { useEffect, useState } from 'react';

import CommandSearchController from '@/actions/App/Http/Controllers/CommandSearchController';

export type CommandPost = {
    id: string;
    excerpt: string;
    status: string;
    scheduled_at: string | null;
};

export function usePostSearch(query: string): {
    posts: CommandPost[];
    loading: boolean;
    error: boolean;
} {
    const [posts, setPosts] = useState<CommandPost[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    const trimmed = query.trim();

    useEffect(() => {
        if (trimmed.length < 2) {
            setPosts([]);
            setLoading(false);
            setError(false);

            return;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError(false);
            const url = `${CommandSearchController.url()}?q=${encodeURIComponent(trimmed)}`;

            fetch(url, {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            })
                .then((res) => res.json() as Promise<{ posts: CommandPost[] }>)
                .then((data) => {
                    setPosts(data.posts);
                    setLoading(false);
                })
                .catch((err: unknown) => {
                    if (
                        err instanceof DOMException &&
                        err.name === 'AbortError'
                    ) {
                        return;
                    }
                    setError(true);
                    setLoading(false);
                });
        }, 200);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [trimmed]);

    return { posts, loading, error };
}
