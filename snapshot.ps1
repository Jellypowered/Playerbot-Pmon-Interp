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

$SourceDir = if ($env:PMON_DIR) { $env:PMON_DIR } elseif ($Config['pmon_dir']) { $Config['pmon_dir'] } else { 'snapshots' }
$DestinationDir = if ($env:PMON_SNAPSHOT_DIR) { $env:PMON_SNAPSHOT_DIR } elseif ($Config['snapshot_dir']) { $Config['snapshot_dir'] } else { 'snapshots' }
if (-not [IO.Path]::IsPathRooted($SourceDir)) { $SourceDir = Join-Path $AppDir $SourceDir }
if (-not [IO.Path]::IsPathRooted($DestinationDir)) { $DestinationDir = Join-Path $AppDir $DestinationDir }
$SourceDir = [IO.Path]::GetFullPath($SourceDir)
$DestinationDir = [IO.Path]::GetFullPath($DestinationDir)
New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null

$Saved = 0
foreach ($File in Get-ChildItem -LiteralPath $SourceDir -File -Filter '*pmon*.json' -ErrorAction SilentlyContinue) {
    if ($File.DirectoryName -eq $DestinationDir) { continue }
    try {
        $Data = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json
        if ($null -eq $Data.generatedAt -or $null -eq $Data.metrics) { continue }
        $Timestamp = [DateTimeOffset]::FromUnixTimeSeconds([long]$Data.generatedAt).UtcDateTime.ToString('yyyyMMddTHHmmssZ')
        $Target = Join-Path $DestinationDir ($File.BaseName + '_' + $Timestamp + $File.Extension)
        Copy-Item -LiteralPath $File.FullName -Destination $Target -Force
        Write-Host "Saved $([IO.Path]::GetFileName($Target))"
        $Saved++
    } catch {
        Write-Warning "Skipping invalid/incomplete PMON export '$($File.Name)': $_"
    }
}
if ($Saved -eq 0) { throw "No valid *pmon*.json exports found in $SourceDir" }
