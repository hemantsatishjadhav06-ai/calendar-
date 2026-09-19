<?php

declare(strict_types=1);

namespace App\Notifications;

use App\Enums\NotificationType;
use App\Models\Post;
use App\Models\PostTarget;
use App\Notifications\Concerns\GatedByPreferences;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

class PublishFailedNotification extends Notification implements ShouldQueue
{
    use GatedByPreferences;
    use Queueable;

    public function __construct(private PostTarget $target)
    {
        $this->afterCommit();
    }

    /**
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return $this->gatedVia($notifiable, NotificationType::PublishFailed);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        $post = $this->target->post()->firstOrFail();

        return $this->databasePayload($post->workspace_id, [
            'event' => NotificationType::PublishFailed->value,
            'title' => 'Failed to publish to '.$this->target->platform->label(),
            'body' => $this->identifierLine($post),
            'href' => route('posts.show', $post),
            'icon' => 'alert-triangle',
        ]);
    }

    public function toMail(object $notifiable): MailMessage
    {
        $post = $this->target->post()->firstOrFail();

        return (new MailMessage)
            ->subject('A post failed to publish')
            ->line('Your post failed to publish on '.$this->target->platform->label().'.')
            ->line('"'.$post->excerpt().'"')
            ->action('View post', route('posts.show', $post));
    }

    /**
     * The account handle (when known) followed by a snippet of the post text,
     * so the recipient can tell which post and destination failed.
     */
    private function identifierLine(Post $post): string
    {
        $handle = $this->target->account?->handle;
        $excerpt = $post->excerpt();

        return $handle !== null ? $handle.' · '.$excerpt : $excerpt;
    }
}
