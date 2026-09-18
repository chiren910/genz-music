<?php
/**
 * Downloads a YouTube track as MP3 at maximum audio quality.
 *
 * Usage: api/download.php?v=<11-char-video-id>
 *
 * Pipeline (single yt-dlp pass):
 *   1. Select the best audio-only stream (never video).
 *   2. Transcode it to 320 kbps CBR MP3 via ffmpeg.
 *   3. Stream the finished file to the browser and clean up.
 */

declare(strict_types=1);

set_time_limit(0);
ignore_user_abort(false);

$vid = isset($_GET['v']) ? trim((string)$_GET['v']) : '';
if (!preg_match('/^[\w-]{11}$/', $vid)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    exit("Invalid video id.");
}

$binDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'tools' . DIRECTORY_SEPARATOR . 'bin';
$ytDlp   = $binDir . DIRECTORY_SEPARATOR . 'yt-dlp.exe';
$ffmpeg  = $binDir . DIRECTORY_SEPARATOR . 'ffmpeg.exe';
if (!is_file($ytDlp)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("yt-dlp not found on server.");
}

/* Temp workspace for the converted MP3. */
$tmpDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'song-dl';
if (!is_dir($tmpDir)) {
    @mkdir($tmpDir, 0777, true);
}
/* Garbage-collect leftovers older than 30 minutes. */
foreach (glob($tmpDir . DIRECTORY_SEPARATOR . '*.mp3') ?: [] as $old) {
    if (is_file($old) && (time() - (int)filemtime($old)) > 1800) {
        @unlink($old);
    }
}

$outTemplate = $tmpDir . DIRECTORY_SEPARATOR . $vid . '.%(ext)s';
$watchUrl = 'https://www.youtube.com/watch?v=' . $vid;

/*
 * One pass: fetch metadata JSON *after* the download finishes
 * (--no-simulate), so we get the final converted filepath + title.
 *
 * Speed / quality flags:
 *   -f bestaudio/best      audio-only source stream, never video
 *   -S abr,asr             prefer highest source bitrate + sample rate
 *   -N 8                   8 parallel HTTP connections (defeats throttling)
 *   -x --audio-format mp3  force MP3 container -> output can never be MP4
 *   --audio-quality 320K   constant 320 kbps stereo — maximum MP3 fidelity
 *   --embed-metadata       ID3 tags (title/artist/uploader) for free
 */
$cmd = '"' . $ytDlp . '"'
     . ' -f bestaudio/best -S abr,asr'
     . ' -x --audio-format mp3 --audio-quality 320K'
     . ' -N 8 --no-part'
     . ' --no-playlist --no-warnings --no-progress --no-check-certificates'
     . ' --no-cache-dir'
     . ' --windows-filenames --trim-filenames 120'
     . ' --embed-metadata'
     . ' --ffmpeg-location "' . $ffmpeg . '"'
     . ' -o "' . $outTemplate . '"'
     . ' --no-simulate'
     . ' --print "after_move:%(filepath)s"'
     . ' --print "after_move:%(title)s"'
     . ' ' . escapeshellarg($watchUrl);

$descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
$proc = proc_open($cmd, $descriptors, $pipes);
if (!is_resource($proc)) {
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("Failed to start yt-dlp.");
}
$stdout = stream_get_contents($pipes[1]);
fclose($pipes[1]);
fclose($pipes[2]);
$code = proc_close($proc);

/* after_move prints emit two lines, in order: filepath, then title. */
$lines = array_values(array_filter(array_map('trim', explode("\n", (string)$stdout)), static fn ($l) => $l !== ''));
$file = '';
$title = '';
foreach ($lines as $i => $line) {
    if (str_ends_with(strtolower($line), '.mp3') && is_file($line)) {
        $file = $line;
        $title = $lines[$i + 1] ?? '';
        break;
    }
}
if ($code !== 0 || $file === '' || !is_file($file)) {
    if ($file !== '' && is_file($file)) @unlink($file);
    http_response_code(502);
    header('Content-Type: text/plain');
    exit("Could not convert this song. It may be private, age-restricted or unavailable.");
}

/* Safety: never ship anything but MP3. */
if (strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'mp3') {
    @unlink($file);
    http_response_code(500);
    header('Content-Type: text/plain');
    exit("Conversion failed: non-MP3 output.");
}

/* Build a safe filename from the title. */
$safe = preg_replace('/[\\\\\/:*?"<>|\x00-\x1F]/u', '', html_entity_decode($title, ENT_QUOTES | ENT_HTML5));
$safe = trim(preg_replace('/\s+/', ' ', (string)$safe));
if ($safe === '') $safe = 'youtube-audio';
if (mb_strlen($safe) > 80) $safe = mb_substr($safe, 0, 80);

header('Content-Type: audio/mpeg');
header('X-Content-Type-Options: nosniff');
header('Accept-Ranges: none');
header('Access-Control-Allow-Origin: *');
header('Content-Disposition: attachment; filename="' . str_replace('"', '', $safe) . '.mp3"; filename*=UTF-8\'\'' . rawurlencode($safe . '.mp3'));
header('Content-Length: ' . (string)filesize($file));
header('Cache-Control: no-store');

/* Stream in chunks so huge files don't blow the memory limit. */
$fh = fopen($file, 'rb');
if ($fh !== false) {
    while (!feof($fh)) {
        echo fread($fh, 256 * 1024);
        flush();
        if (connection_aborted()) break;
    }
    fclose($fh);
}
@unlink($file);
exit;
