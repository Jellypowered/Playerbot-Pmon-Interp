param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$AppDir = $PSScriptRoot
$ConfigPath = if ($env:PMON_CONFIG) { $env:PMON_CONFIG } else { Join-Path $AppDir 'pmon.conf' }
$Config = @{}
$Section = ''
if (Test-Path -LiteralPath $ConfigPath) {
    foreach ($Line in Get-Content -LiteralPath $ConfigPath) {
        $Text = $Line.Trim()
        if ($Text -match '^\[([^]]+)\]$') { $Section = $Matches[1]; continue }
        if ($Section -eq 'server' -and $Text -match '^([^#;][^=]*)=(.*)$') {
            $Config[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
}

function Get-Setting([string]$EnvironmentName, [string]$ConfigName, [string]$Default) {
    if (Test-Path "Env:$EnvironmentName") { return (Get-Item "Env:$EnvironmentName").Value }
    if ($Config.ContainsKey($ConfigName) -and $Config[$ConfigName]) { return $Config[$ConfigName] }
    return $Default
}

$PmonDir = Get-Setting 'PMON_DIR' 'pmon_dir' 'snapshots'
if (-not [IO.Path]::IsPathRooted($PmonDir)) { $PmonDir = Join-Path $AppDir $PmonDir }
$PmonDir = [IO.Path]::GetFullPath($PmonDir)
$SnapshotDir = Get-Setting 'PMON_SNAPSHOT_DIR' 'snapshot_dir' 'snapshots'
if (-not [IO.Path]::IsPathRooted($SnapshotDir)) { $SnapshotDir = Join-Path $AppDir $SnapshotDir }
$SnapshotDir = [IO.Path]::GetFullPath($SnapshotDir)
$Bind = Get-Setting 'PMON_BIND' 'bind' '0.0.0.0'
$Port = Get-Setting 'PMON_PORT' 'port' '8089'
$Session = Get-Setting 'PMON_TMUX_SESSION' 'tmux_session' 'pmon-interp'
$PidFile = Join-Path $AppDir '.pmon-server.pid'
$StdoutLog = Join-Path $AppDir '.pmon-server.out.log'
$StderrLog = Join-Path $AppDir '.pmon-server.err.log'

function Get-ServerProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    $SavedPid = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$SavedPid)) { return $null }
    $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $SavedPid" -ErrorAction SilentlyContinue
    if (-not $ProcessInfo -or $ProcessInfo.CommandLine -notlike '*server.py*' -or $ProcessInfo.CommandLine -notlike "*$AppDir*") { return $null }
    return Get-Process -Id $SavedPid -ErrorAction SilentlyContinue
}

function Quote-Argument([string]$Value) {
    if ($Value -notmatch '[\s"]') { return $Value }
    $Builder = [Text.StringBuilder]::new()
    [void]$Builder.Append('"')
    $Slashes = 0
    foreach ($Character in $Value.ToCharArray()) {
        if ($Character -eq '\') { $Slashes++; continue }
        if ($Character -eq '"') {
            [void]$Builder.Append(('\' * (2 * $Slashes + 1)) + '"')
        } else {
            [void]$Builder.Append(('\' * $Slashes) + $Character)
        }
        $Slashes = 0
    }
    [void]$Builder.Append(('\' * (2 * $Slashes)) + '"')
    return $Builder.ToString()
}

function Start-Server {
    if (-not (Test-Path -LiteralPath $PmonDir -PathType Container)) { throw "PMON directory not found: $PmonDir" }
    if (Get-ServerProcess) { Write-Host "PMON server already running at http://${Bind}:${Port}"; return }
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) { throw 'Python 3 is required. Install Python and ensure python.exe is on PATH.' }
    $Arguments = @('-u', (Join-Path $AppDir 'server.py'), '--directory', $AppDir, '--pmon-dir', $PmonDir, '--snapshot-dir', $SnapshotDir, '--port', $Port, '--bind', $Bind)
    $CommandLine = ($Arguments | ForEach-Object { Quote-Argument ([string]$_) }) -join ' '
    $Process = Start-Process -FilePath $Python.Source -ArgumentList $CommandLine -WorkingDirectory $AppDir -WindowStyle Hidden -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
    Set-Content -LiteralPath $PidFile -Value $Process.Id -NoNewline
    Start-Sleep -Milliseconds 500
    if (-not (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
        throw "PMON server failed to start. See $StdoutLog or $StderrLog"
    }
    Write-Host "PMON server started (PID $($Process.Id)): http://${Bind}:${Port}"
    Write-Host "Live exports: $PmonDir"
}

function Stop-Server {
    $Process = Get-ServerProcess
    if ($Process) {
        Stop-Process -Id $Process.Id
        Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
        Write-Host 'PMON server stopped.'
    } else {
        Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
        Write-Host 'PMON server is not running.'
    }
}

switch ($Action) {
    'start' { Start-Server }
    'stop' { Stop-Server }
    'restart' { Stop-Server; Start-Server }
    'status' {
        $Process = Get-ServerProcess
        if ($Process) { Write-Host "PMON server is running (PID $($Process.Id)): http://${Bind}:${Port}" }
        else { Write-Host 'PMON server is not running.'; exit 1 }
    }
}
