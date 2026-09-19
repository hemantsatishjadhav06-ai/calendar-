import SocialButton from '@/components/socialite/social-button';
import type { SocialProviderOption } from '@/types/auth';

type Props = {
    providers: SocialProviderOption[];
    invitation?: string;
};

export default function SocialLoginList({ providers, invitation }: Props) {
    if (providers.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3">
            {providers.map((option) => (
                <SocialButton
                    key={option.provider}
                    provider={option.provider}
                    label={option.label}
                    invitation={invitation}
                />
            ))}
        </div>
    );
}
