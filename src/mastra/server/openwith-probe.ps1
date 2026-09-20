# openwith-probe.ps1
# Enumerate "Open with" apps for a file extension. Output: JSON array of
# { name, command, isDefault, iconBase64? }
#
# IMPORTANT: keep this file ASCII-only. PowerShell 5.1 misdecodes UTF-8
# without BOM, and Chinese comments break the parser (verified 2026-09-18).
#
# Design notes (rewritten 2026-09-18 after user feedback "stuck on loading"):
# 1. Use .NET Microsoft.Win32.Registry directly. No HKCR: PSDrive, no
#    Get-StartApps / Get-AppxPackage - those slow paths pushed enumeration to
#    14-25 seconds and the submenu appeared stuck.
# 2. App display name comes from the exe's FileVersionInfo.FileDescription
#    (gives "Microsoft Edge", "Notepad"), NOT the ProgID FriendlyTypeName
#    (which gives "Microsoft Edge HTML Document" - a type name, not an app).
# 3. Dedupe by exe path so one program registered under several ProgIDs
#    appears only once.
param([string]$Ext = "")

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ext = $Ext.TrimStart('.')
if ([string]::IsNullOrEmpty($ext)) { Write-Output "[]"; exit 0 }

try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop } catch { }

$classesRoot = [Microsoft.Win32.Registry]::ClassesRoot
$currentUser = [Microsoft.Win32.Registry]::CurrentUser
$localMachine = [Microsoft.Win32.Registry]::LocalMachine

$progIds = New-Object System.Collections.Generic.List[string]
$defaultProgId = $null

function Add-ProgId([string]$value) {
    if (-not [string]::IsNullOrEmpty($value)) {
        if (-not $progIds.Contains($value)) { $progIds.Add($value) }
    }
}

# 1) UserChoice = the user's chosen default program
try {
    $uc = $currentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$ext\UserChoice")
    if ($uc -ne $null) {
        $defaultProgId = [string]$uc.GetValue("ProgId")
        Add-ProgId $defaultProgId
        $uc.Close()
    }
} catch { }

# 2) HKCR\.ext default value = system association; 3) OpenWithProgids = others
try {
    $extKey = $classesRoot.OpenSubKey(".$ext")
    if ($extKey -ne $null) {
        $sysDefault = [string]$extKey.GetValue($null)
        if ([string]::IsNullOrEmpty($defaultProgId)) { $defaultProgId = $sysDefault }
        Add-ProgId $sysDefault
        $owp = $extKey.OpenSubKey("OpenWithProgids")
        if ($owp -ne $null) {
            foreach ($n in $owp.GetValueNames()) { Add-ProgId $n }
            $owp.Close()
        }
        $extKey.Close()
    }
} catch { }

# 4) OpenWithList = explorer "open with" history (values are exe file names)
$openWithExes = New-Object System.Collections.Generic.List[string]
try {
    $owl = $currentUser.OpenSubKey("Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$ext\OpenWithList")
    if ($owl -ne $null) {
        foreach ($n in $owl.GetValueNames()) {
            if ($n -ne "MRUList") {
                $v = [string]$owl.GetValue($n)
                if (-not [string]::IsNullOrEmpty($v)) {
                    if (-not $openWithExes.Contains($v)) { $openWithExes.Add($v) }
                }
            }
        }
        $owl.Close()
    }
} catch { }

function Get-CommandFor([string]$progid) {
    $paths = @("$progid\shell\open\command", "$progid\Shell\Open\Command")
    foreach ($path in $paths) {
        try {
            $k = $classesRoot.OpenSubKey($path)
            if ($k -ne $null) {
                $v = [string]$k.GetValue($null)
                $k.Close()
                if (-not [string]::IsNullOrEmpty($v)) { return $v }
            }
        } catch { }
    }
    return $null
}

function Get-ExePath([string]$command) {
    if ([string]::IsNullOrEmpty($command)) { return $null }
    $c = $command.Trim()
    if ($c.StartsWith('"')) {
        $end = $c.IndexOf('"', 1)
        if ($end -gt 1) { return $c.Substring(1, $end - 1) }
    }
    $sp = $c.IndexOf(' ')
    if ($sp -gt 0) { return $c.Substring(0, $sp) }
    return $c
}

function Get-AppName([string]$exe, [string]$fallback) {
    try {
        if (-not [string]::IsNullOrEmpty($exe)) {
            if (Test-Path -LiteralPath $exe) {
                $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
                if (-not [string]::IsNullOrEmpty($info.FileDescription)) {
                    return $info.FileDescription.Trim()
                }
                if (-not [string]::IsNullOrEmpty($info.ProductName)) {
                    return $info.ProductName.Trim()
                }
                return [System.IO.Path]::GetFileNameWithoutExtension($exe)
            }
        }
    } catch { }
    return $fallback
}

function Get-IconBase64([string]$exe) {
    try {
        if ([string]::IsNullOrEmpty($exe)) { return $null }
        if (-not (Test-Path -LiteralPath $exe)) { return $null }
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
        if ($icon -eq $null) { return $null }
        $bmp = New-Object System.Drawing.Bitmap(32, 32)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $rect = New-Object System.Drawing.Rectangle(0, 0, 32, 32)
        $g.DrawIcon($icon, $rect)
        $g.Dispose()
        $icon.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $ms.Dispose()
        $bmp.Dispose()
        return [Convert]::ToBase64String($bytes)
    } catch { return $null }
}

function Resolve-ExeName([string]$name) {
    $sub = "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$name"
    foreach ($root in @($localMachine, $currentUser)) {
        try {
            $k = $root.OpenSubKey($sub)
            if ($k -ne $null) {
                $p = [string]$k.GetValue($null)
                $k.Close()
                if (-not [string]::IsNullOrEmpty($p)) { return $p.Trim('"') }
            }
        } catch { }
    }
    return $null
}

$seenExe = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
$result = New-Object System.Collections.Generic.List[object]

foreach ($progid in $progIds) {
    try {
        $command = Get-CommandFor $progid
        if ([string]::IsNullOrEmpty($command)) { continue }
        $exe = Get-ExePath $command
        if ([string]::IsNullOrEmpty($exe)) { continue }
        if (-not $seenExe.Add($exe)) { continue }
        $item = New-Object psobject
        $item | Add-Member -MemberType NoteProperty -Name name -Value (Get-AppName $exe $progid)
        $item | Add-Member -MemberType NoteProperty -Name command -Value $command
        $item | Add-Member -MemberType NoteProperty -Name isDefault -Value ($progid -eq $defaultProgId)
        $icon = Get-IconBase64 $exe
        if (-not [string]::IsNullOrEmpty($icon)) {
            $item | Add-Member -MemberType NoteProperty -Name iconBase64 -Value $icon
        }
        $result.Add($item)
    } catch { }
}

foreach ($exeName in $openWithExes) {
    try {
        $full = Resolve-ExeName $exeName
        if ([string]::IsNullOrEmpty($full)) { continue }
        if (-not (Test-Path -LiteralPath $full)) { continue }
        if (-not $seenExe.Add($full)) { continue }
        $item = New-Object psobject
        $item | Add-Member -MemberType NoteProperty -Name name -Value (Get-AppName $full $exeName)
        $item | Add-Member -MemberType NoteProperty -Name command -Value ('"' + $full + '" "%1"')
        $item | Add-Member -MemberType NoteProperty -Name isDefault -Value $false
        $icon = Get-IconBase64 $full
        if (-not [string]::IsNullOrEmpty($icon)) {
            $item | Add-Member -MemberType NoteProperty -Name iconBase64 -Value $icon
        }
        $result.Add($item)
    } catch { }
}

if ($result.Count -eq 0) {
    Write-Output "[]"
} else {
    # Serialize item by item and join manually. PowerShell 5.1's
    # "ConvertTo-Json -InputObject <List>" throws "Argument types do not match",
    # and the pipeline form unwraps single-element arrays into a bare object.
    # Building the array text ourselves avoids both quirks.
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($item in $result) {
        $parts.Add((ConvertTo-Json -InputObject $item -Compress -Depth 3))
    }
    Write-Output ("[" + [string]::Join(",", $parts.ToArray()) + "]")
}
