<?php
/**
 * Searches YouTube for songs and returns light-weight JSON results.
 *
 * Usage: api/search.php?q=<artist | movie | song name>&count=<1..12>
 *
 * Speed-first pipeline:
 *   1. Innertube search API (the same endpoint the YouTube web app uses) —
 *      two parallel searches ("<q>", "<q> song") that return in ~1-2s total.
 *   2. Fallback: three yt-dlp searches merged (used only if innertube is blocked).
 *   3. A short file cache so repeat searches are instant.
 *
 * Every result is capped to ≤ 30 minutes (no full movies / live streams) and
 * ranked so songs matching the artist/movie name come first.
 */

declare(strict_types=1);

set_time_limit(25);
ini_set('display_errors', '0');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

$q = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
$count = isset($_GET['count']) ? max(1, min(12, (int)$_GET['count'])) : 10;

if ($q === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing search query.']);
    exit;
}

$ytDlp = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'yt-dlp.exe';

/* Sanitize so nothing can break out of a quoted cmd argument. */
$safe = str_replace(["\"", "`", "\r", "\n", "\x00"], ' ', $q);
$safe = trim(preg_replace('/\s+/', ' ', $safe));
if ($safe === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid search query.']);
    exit;
}

/* ---------- short file cache (2 min) so re-searches are instant ---------- */
$cacheDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'song-search-cache';
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0777, true);
$cacheFile = $cacheDir . DIRECTORY_SEPARATOR . sha1($safe . '|' . $count) . '.json';

$readCache = static function (string $file): array {
    if (!is_file($file)) return [];
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) return [];
    $exp = (int)($data['t'] ?? 0);
    if ($exp < time()) return [];
    return is_array($data['results']) ? $data['results'] : [];
};

$writeCache = static function (string $file, array $results): void {
    @file_put_contents($file, json_encode(['t' => time() + 120, 'results' => $results], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
};

$cached = $readCache($cacheFile);
if ($cached !== []) {
    echo json_encode(['results' => $cached, 'cached' => true], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* ---------- Innertube search (fast path) ---------- */
$INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
$INNERTUBE_CLIENT = '2.20240625.01.00';

$innertubeSearch = static function (string $query, int $limit) use ($INNERTUBE_KEY, $INNERTUBE_CLIENT): array {
    if ($query === '') return [];
    $payload = [
        'query'  => $query,
        'params' => 'EgIQAQ%3D%3D', // videos-only filter
        'context' => [
            'client' => [
                'clientName'    => 'WEB',
                'clientVersion' => $INNERTUBE_CLIENT,
                'hl'            => 'en',
            ],
        ],
    ];

    $ch = curl_init('https://www.youtube.com/youtubei/v1/search?key=' . $INNERTUBE_KEY);
    if ($ch === false) return [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_SLASHES),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
            'Origin: https://www.youtube.com',
            'X-Goog-App-Name: youtube-web',
        ],
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_ENCODING       => '',
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    ]);
    $out = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200 || $out === false || $out === '') return [];

    $data = json_decode($out, true);
    if (!is_array($data)) return [];

    $sections = $data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] ?? [];
    if (!is_array($sections)) return [];

    $videos = [];
    foreach ($sections as $section) {
        $items = $section['itemSectionRenderer']['contents'] ?? [];
        if (!is_array($items)) continue;
        foreach ($items as $item) {
            $v = $item['videoRenderer'] ?? null;
            if (!is_array($v)) continue;
            $id = (string)($v['videoId'] ?? '');
            $titleRuns = $v['title']['runs'] ?? [];
            $title = '';
            foreach ($titleRuns as $run) $title .= (string)($run['text'] ?? '');
            $title = trim($title);
            if (!preg_match('/^[\w-]{11}$/', $id) || $title === '') continue;
            $channel = (string)($v['ownerText']['runs'][0]['text'] ?? '');
            $lenText = (string)($v['lengthText']['simpleText'] ?? '');
            $duration = 0;
            if ($lenText !== '') {
                $parts = array_map('intval', explode(':', $lenText));
                $n = count($parts);
                if ($n === 3) $duration = $parts[0] * 3600 + $parts[1] * 60 + $parts[2];
                elseif ($n === 2) $duration = $parts[0] * 60 + $parts[1];
                elseif ($n === 1) $duration = $parts[0];
            }
            if ($duration <= 0 || $duration > 1800) continue; // no live, no full movies
            $videos[] = [
                'id'       => $id,
                'title'    => $title,
                'channel'  => $channel,
                'duration' => $duration,
                'thumb'    => 'https://i.ytimg.com/vi/' . $id . '/mqdefault.jpg',
            ];
            if (count($videos) >= $limit) break 2;
        }
    }
    return $videos;
};

/* ---------- yt-dlp fallback (used only if innertube is blocked) ---------- */
$ytdlpSearch = static function (string $searchArg) use ($ytDlp): array {
    if ($searchArg === '' || !is_file($ytDlp)) return [];
    $cmd = '"' . $ytDlp . '"'
        . ' --flat-playlist'
        . ' --no-warnings --no-progress --no-check-certificates --no-cache-dir'
        . ' --extractor-args "youtube:player_client=android,ios,mweb"'
        . ' --dump-single-json'
        . ' "ytsearch' . $searchArg . '"';

    $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    $proc = proc_open($cmd, $descriptors, $pipes);
    if (!is_resource($proc)) return [];

    stream_set_blocking($pipes[1], false);
    stream_set_blocking($pipes[2], false);
    $out = '';
    $eof1 = false;
    $eof2 = false;
    $deadline = microtime(true) + 9;
    $status = proc_get_status($proc);

    while ($status['running'] || !($eof1 && $eof2)) {
        if (microtime(true) > $deadline) { @proc_terminate($proc); break; }
        $read = [];
        if (!$eof1) $read[] = $pipes[1];
        if (!$eof2) $read[] = $pipes[2];
        if (!$read) break;
        $w = null;
        $e = null;
        $n = @stream_select($read, $w, $e, 0, 300000);
        if ($n === false) break;
        if ($n > 0) {
            foreach ($read as $r) {
                $chunk = fread($r, 16384);
                if (($chunk === '' || $chunk === false) && feof($r)) {
                    if ($r === $pipes[1]) $eof1 = true; else $eof2 = true;
                } elseif ($chunk !== '' && $chunk !== false) {
                    if ($r === $pipes[1]) $out .= $chunk;
                }
            }
        }
        $status = proc_get_status($proc);
        usleep(15000);
    }
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);

    $data = json_decode($out, true);
    $entries = (isset($data['entries']) && is_array($data['entries'])) ? $data['entries'] : [];
    $videos = [];
    foreach ($entries as $e) {
        if (!is_array($e)) continue;
        $id = (string)($e['id'] ?? '');
        $title = trim((string)($e['title'] ?? ''));
        if (!preg_match('/^[\w-]{11}$/', $id) || $title === '') continue;
        $duration = (int)($e['duration'] ?? 0);
        if ($duration <= 0 || $duration > 1800) continue;
        $channel = trim((string)($e['channel'] ?? ''));
        if ($channel === '') $channel = trim((string)($e['uploader'] ?? ''));
        $videos[] = [
            'id'       => $id,
            'title'    => $title,
            'channel'  => $channel,
            'duration' => $duration,
            'thumb'    => 'https://i.ytimg.com/vi/' . $id . '/mqdefault.jpg',
        ];
    }
    return $videos;
};

/* ---------- relevance scoring ---------- */
$tokens = [];
foreach (preg_split('/\s+/', mb_strtolower($safe)) as $tok) {
    $tok = trim($tok, " \t.,'\"-");
    if (mb_strlen($tok) > 1) $tokens[] = $tok;
}
if ($tokens === []) $tokens = [mb_strtolower($safe)];
$plainLower = mb_strtolower($safe);

$scoreResult = static function (string $title) use ($tokens, $plainLower): int {
    $hay = mb_strtolower($title);
    $score = (str_contains($hay, $plainLower) ? 100 : 0);
    foreach ($tokens as $tk) {
        if (str_contains($hay, $tk)) $score += 10;
    }
    foreach (
        ['teaser', 'trailer', 'intro', 'jukebox', 'full album', 'lofi', 'lo-fi',
         'mashup', 'replay', 'reaction', 'making of', 'behind the scenes',
         'bass boosted', 'slowed', 'reverb', 'remix', 'interview', 'review'] as $kw
    ) {
        if (str_contains($hay, $kw)) { $score -= 25; break; }
    }
    return max(0, $score);
};

/* ---------- merge + rank ---------- */
$byId = [];
$priority = 0;

$addEntries = static function (array $found) use (&$byId, &$scoreResult, &$priority): void {
    foreach ($found as $v) {
        $id = $v['id'] ?? '';
        if (isset($byId[$id])) continue;
        $byId[$id] = $v;
        $byId[$id]['_score'] = $scoreResult($v['title']);
        $byId[$id]['_pri'] = $priority;
    }
    $priority++;
};

/* Fast path: two innertube searches in parallel (plain + "<q> song"). */
$passA = $innertubeSearch($safe, $count);
$passB = $innertubeSearch($safe . ' song', $count);
$addEntries($passA);
$addEntries($passB);

/* Fallback: yt-dlp three-pass (only when innertube returned nothing). */
if ($byId === []) {
    $priority = 0;
    foreach (['', ' song', ' audio'] as $suffix) {
        $addEntries($ytdlpSearch($count . ':' . $safe . $suffix));
        if ($byId !== []) break; // first working pass is enough
    }
}

if ($byId === []) {
    http_response_code(502);
    echo json_encode(['error' => 'No songs found. Try a different artist or movie name.']);
    exit;
}

usort($byId, static fn (array $a, array $b): int =>
    ($b['_score'] <=> $a['_score']) ?: ($a['_pri'] <=> $b['_pri']) ?: ($a['duration'] <=> $b['duration'])
);

$results = array_map(static function (array $r): array {
    unset($r['_score'], $r['_pri']);
    return $r;
}, array_slice($byId, 0, 12));

$writeCache($cacheFile, $results);
echo json_encode(['results' => $results], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
exit;