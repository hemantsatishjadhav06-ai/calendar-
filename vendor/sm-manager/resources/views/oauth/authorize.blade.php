@php /** @var \Laravel\Passport\Client $client */ @endphp
@php /** @var \Illuminate\Support\Collection $workspaces */ @endphp
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Authorize Application</title>
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
    <link rel="manifest" href="/site.webmanifest">
    <meta name="theme-color" content="#101010">
</head>
<body>
    <h1>Authorize {{ $client->name }}</h1>

    <p><strong>{{ $client->name }}</strong> is requesting access to act on your behalf.</p>

    @if (count($scopes) > 0)
        <h2>Requested Scopes</h2>
        <ul>
            @foreach ($scopes as $scope)
                <li>{{ $scope->id }}</li>
            @endforeach
        </ul>
    @endif

    <form method="POST" action="{{ route('passport.authorizations.approve') }}">
        @csrf
        <input type="hidden" name="auth_token" value="{{ $authToken }}">
        <input type="hidden" name="client_id" value="{{ $client->getKey() }}">

        <label for="workspace_id">Workspace</label>
        <select name="workspace_id" id="workspace_id" required>
            @foreach ($workspaces as $workspace)
                <option value="{{ $workspace->id }}">{{ $workspace->name }}</option>
            @endforeach
        </select>

        <button type="submit">Authorize</button>
    </form>

    <form method="POST" action="{{ route('passport.authorizations.deny') }}">
        @csrf
        @method('DELETE')
        <input type="hidden" name="auth_token" value="{{ $authToken }}">
        <input type="hidden" name="client_id" value="{{ $client->getKey() }}">

        <button type="submit">Cancel</button>
    </form>
</body>
</html>
