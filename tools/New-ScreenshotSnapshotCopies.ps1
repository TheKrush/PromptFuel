[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$MachineMapJson,

    [string]$SourcePath,

    [string]$SettingsPath = (Join-Path $env:APPDATA "Code\User\settings.json"),

    [switch]$Force,

    [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$SnapshotSchemaVersion = 1
$ArchiveSchemaVersion = 1
$LatestRootFields = @("schemaVersion", "writerVersion", "generatedAtEpochMs", "machineLabel", "providerUsage")
$ProviderFields = @("provider", "sourceLabel", "fiveHourUsedPercent", "sevenDayUsedPercent", "fiveHourResetAtEpochSeconds", "sevenDayResetAtEpochSeconds", "lastUpdatedEpochMs", "stale", "source", "sourceConfidence", "historyBuckets")
$ProviderNames = @("claude", "codex")
$ProviderSources = @("authenticated", "localSession", "hook", "snapshot", "cache", "stale", "unknown")
$SourceConfidences = @("trustedCompletedTurnUsage", "correlatedDayBucket", "mixedDayBucket", "quotaState", "snapshotOnly", "apiEquivalentEstimate", "unavailable")
$BucketFields = @("dateKey", "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "requests", "messages", "turns", "sourceConfidence", "models")
$ModelFields = @("model", "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "requests", "messages", "turns")
$ArchiveRootFields = @("schemaVersion", "archiveSchemaVersion", "generatedAtEpochMs", "machineLabel", "month", "providers", "writerVersion")
$ArchiveProviderFields = @("provider", "historyBuckets")

$NodeValidatorScript = @'
const fs = require('fs');
const [kind, filePath, expectedMachineLabel, displayPathArg] = process.argv.slice(1);
const displayPath = displayPathArg || filePath;
const expected = expectedMachineLabel === '__NO_EXPECTED__' ? undefined : expectedMachineLabel;
const errors = [];
const snapshotSchemaVersion = 1;
const archiveSchemaVersion = 1;
const latestRootFields = ['schemaVersion', 'writerVersion', 'generatedAtEpochMs', 'machineLabel', 'providerUsage'];
const providerFields = ['provider', 'sourceLabel', 'fiveHourUsedPercent', 'sevenDayUsedPercent', 'fiveHourResetAtEpochSeconds', 'sevenDayResetAtEpochSeconds', 'lastUpdatedEpochMs', 'stale', 'source', 'sourceConfidence', 'historyBuckets'];
const providerNames = ['claude', 'codex'];
const providerSources = ['authenticated', 'localSession', 'hook', 'snapshot', 'cache', 'stale', 'unknown'];
const sourceConfidences = ['trustedCompletedTurnUsage', 'correlatedDayBucket', 'mixedDayBucket', 'quotaState', 'snapshotOnly', 'apiEquivalentEstimate', 'unavailable'];
const bucketFields = ['dateKey', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns', 'sourceConfidence', 'models'];
const modelFields = ['model', 'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns'];
const archiveRootFields = ['schemaVersion', 'archiveSchemaVersion', 'generatedAtEpochMs', 'machineLabel', 'month', 'providers', 'writerVersion'];
const archiveProviderFields = ['provider', 'historyBuckets'];
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed, location) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push(`${displayPath}: ${location} has unsupported field '${key}'`);
    }
  }
}
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function optionalNumber(value, location) {
  if (value !== undefined && !isNumber(value)) {
    errors.push(`${displayPath}: ${location} must be a number when present`);
  }
}
function validateModel(model, location) {
  if (!isObject(model)) {
    errors.push(`${displayPath}: ${location} must be an object`);
    return;
  }
  hasOnlyKeys(model, modelFields, location);
  if (typeof model.model !== 'string' || model.model.length === 0) {
    errors.push(`${displayPath}: ${location}.model must be a non-empty string`);
  }
  for (const field of modelFields.filter(field => field !== 'model')) {
    optionalNumber(model[field], `${location}.${field}`);
  }
}
function validateBucket(bucket, month, location) {
  if (!isObject(bucket)) {
    errors.push(`${displayPath}: ${location} must be an object`);
    return;
  }
  hasOnlyKeys(bucket, bucketFields, location);
  if (typeof bucket.dateKey !== 'string' || bucket.dateKey.length === 0) {
    errors.push(`${displayPath}: ${location}.dateKey must be a non-empty string`);
  } else if (month && !new RegExp(`^${month.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{2}$`).test(bucket.dateKey)) {
    errors.push(`${displayPath}: ${location}.dateKey must be inside archive month '${month}'`);
  }
  for (const field of ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'reasoningOutputTokens', 'requests', 'messages', 'turns']) {
    optionalNumber(bucket[field], `${location}.${field}`);
  }
  if (bucket.sourceConfidence !== undefined && typeof bucket.sourceConfidence !== 'string') {
    errors.push(`${displayPath}: ${location}.sourceConfidence must be a string when present`);
  }
  if (bucket.models !== undefined) {
    if (!Array.isArray(bucket.models)) {
      errors.push(`${displayPath}: ${location}.models must be an array when present`);
    } else {
      bucket.models.forEach((model, index) => validateModel(model, `${location}.models[${index}]`));
    }
  }
}
function validateLatest(root) {
  if (!isObject(root)) {
    errors.push(`${displayPath}: latest snapshot must be a JSON object`);
    return;
  }
  hasOnlyKeys(root, latestRootFields, 'latest snapshot');
  if (root.schemaVersion !== snapshotSchemaVersion) {
    errors.push(`${displayPath}: schemaVersion must be ${snapshotSchemaVersion}`);
  }
  if (typeof root.writerVersion !== 'string' || root.writerVersion.length === 0) {
    errors.push(`${displayPath}: writerVersion must be a non-empty string`);
  }
  if (!isNumber(root.generatedAtEpochMs)) {
    errors.push(`${displayPath}: generatedAtEpochMs must be numeric`);
  }
  if (typeof root.machineLabel !== 'string' || root.machineLabel.length === 0) {
    errors.push(`${displayPath}: machineLabel must be a non-empty string`);
  } else if (expected && root.machineLabel !== expected) {
    errors.push(`${displayPath}: machineLabel '${root.machineLabel}' did not match expected '${expected}'`);
  }
  if (root.providerUsage !== undefined) {
    if (!Array.isArray(root.providerUsage)) {
      errors.push(`${displayPath}: providerUsage must be an array when present`);
    } else {
      root.providerUsage.forEach((provider, index) => {
        const location = `providerUsage[${index}]`;
        if (!isObject(provider)) {
          errors.push(`${displayPath}: ${location} must be an object`);
          return;
        }
        hasOnlyKeys(provider, providerFields, location);
        if (!providerNames.includes(provider.provider)) {
          errors.push(`${displayPath}: ${location}.provider must be claude or codex`);
        }
        if (typeof provider.sourceLabel !== 'string') {
          errors.push(`${displayPath}: ${location}.sourceLabel must be a string`);
        }
        if (typeof provider.stale !== 'boolean') {
          errors.push(`${displayPath}: ${location}.stale must be boolean`);
        }
        if (!providerSources.includes(provider.source)) {
          errors.push(`${displayPath}: ${location}.source is not supported`);
        }
        if (!sourceConfidences.includes(provider.sourceConfidence)) {
          errors.push(`${displayPath}: ${location}.sourceConfidence is not supported`);
        }
        for (const field of ['fiveHourUsedPercent', 'sevenDayUsedPercent', 'fiveHourResetAtEpochSeconds', 'sevenDayResetAtEpochSeconds', 'lastUpdatedEpochMs']) {
          optionalNumber(provider[field], `${location}.${field}`);
        }
        if (provider.historyBuckets !== undefined) {
          if (!Array.isArray(provider.historyBuckets)) {
            errors.push(`${displayPath}: ${location}.historyBuckets must be an array when present`);
          } else {
            provider.historyBuckets.forEach((bucket, bucketIndex) => validateBucket(bucket, undefined, `${location}.historyBuckets[${bucketIndex}]`));
          }
        }
      });
    }
  }
}
function validateArchive(root) {
  if (!isObject(root)) {
    errors.push(`${displayPath}: archive payload must be a JSON object`);
    return;
  }
  hasOnlyKeys(root, archiveRootFields, 'archive');
  if (root.schemaVersion !== snapshotSchemaVersion) {
    errors.push(`${displayPath}: archive schemaVersion must be ${snapshotSchemaVersion}`);
  }
  if (root.archiveSchemaVersion !== archiveSchemaVersion) {
    errors.push(`${displayPath}: archiveSchemaVersion must be ${archiveSchemaVersion}`);
  }
  if (!isNumber(root.generatedAtEpochMs)) {
    errors.push(`${displayPath}: archive generatedAtEpochMs must be numeric`);
  }
  if (typeof root.writerVersion !== 'string' || root.writerVersion.length === 0) {
    errors.push(`${displayPath}: archive writerVersion must be a non-empty string`);
  }
  if (typeof root.machineLabel !== 'string' || root.machineLabel.length === 0) {
    errors.push(`${displayPath}: archive machineLabel must be a non-empty string`);
  } else if (expected && root.machineLabel !== expected) {
    errors.push(`${displayPath}: archive machineLabel '${root.machineLabel}' did not match expected '${expected}'`);
  }
  if (typeof root.month !== 'string' || !/^\d{4}-\d{2}$/.test(root.month)) {
    errors.push(`${displayPath}: archive month must be YYYY-MM`);
  }
  if (!Array.isArray(root.providers)) {
    errors.push(`${displayPath}: archive providers must be an array`);
  } else {
    root.providers.forEach((provider, index) => {
      const location = `archive providers[${index}]`;
      if (!isObject(provider)) {
        errors.push(`${displayPath}: ${location} must be an object`);
        return;
      }
      hasOnlyKeys(provider, archiveProviderFields, location);
      if (!providerNames.includes(provider.provider)) {
        errors.push(`${displayPath}: ${location}.provider must be claude or codex`);
      }
      if (!Array.isArray(provider.historyBuckets)) {
        errors.push(`${displayPath}: ${location}.historyBuckets must be an array`);
      } else {
        provider.historyBuckets.forEach((bucket, bucketIndex) => validateBucket(bucket, root.month, `${location}.historyBuckets[${bucketIndex}]`));
      }
    });
  }
}
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (error) {
  console.error(`${displayPath}: invalid JSON: ${error.message}`);
  process.exit(2);
}
if (kind === 'latest') {
  validateLatest(parsed);
} else if (kind === 'archive') {
  validateArchive(parsed);
} else {
  errors.push(`${displayPath}: unknown validation kind '${kind}'`);
}
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(2);
}
'@

$NodeSourceIdScript = @'
const fs = require('fs');
const root = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (typeof root.machineLabel !== 'string' || !Array.isArray(root.providerUsage)) process.exit(0);
for (const provider of root.providerUsage) {
  if (provider && typeof provider.provider === 'string') {
    console.log(`${root.machineLabel}/${provider.provider}`);
  }
}
'@

function ConvertFrom-JsonStringLiteral {
    param([Parameter(Mandatory = $true)][string]$Literal)

    $decoded = ConvertFrom-Json -InputObject "[$Literal]"
    if ($decoded -is [array]) {
        return [string]$decoded[0]
    }
    return [string]$decoded
}

function Get-VsCodeSettingString {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "VS Code settings file was not found at '$Path'. Pass -SourcePath explicitly."
    }

    $content = Get-Content -Raw -LiteralPath $Path
    $pattern = '(?s)"' + [regex]::Escape($Name) + '"\s*:\s*(?<value>"(?:\\.|[^"\\])*")'
    $match = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        throw "Could not find '$Name' in '$Path'. Pass -SourcePath explicitly."
    }

    return ConvertFrom-JsonStringLiteral -Literal $match.Groups["value"].Value
}

function Get-ResolvedDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    $resolved = Resolve-Path -LiteralPath $expanded -ErrorAction Stop
    $providerPath = $resolved.ProviderPath
    if (-not (Test-Path -LiteralPath $providerPath -PathType Container)) {
        throw "Snapshot path does not exist or is not a directory: $providerPath"
    }
    return $providerPath
}

function Get-MachineMapEntries {
    param([Parameter(Mandatory = $true)][string]$Json)

    $parsed = ConvertFrom-Json -InputObject $Json
    $properties = @($parsed.PSObject.Properties)
    if ($parsed -is [array] -or $properties.Count -eq 0) {
        throw "-MachineMapJson must be a JSON object mapping old labels to new labels."
    }

    $entries = @()
    $newLabels = @{}
    foreach ($prop in $properties) {
        if ([string]::IsNullOrWhiteSpace($prop.Name)) {
            throw "-MachineMapJson contains an empty old machine label."
        }
        if ($prop.Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
            throw "-MachineMapJson values must be non-empty strings."
        }

        $oldLabel = [string]$prop.Name
        $newLabel = [string]$prop.Value
        if ($oldLabel -ceq $newLabel) {
            throw "Old and new machine labels must differ: '$oldLabel'."
        }
        if ($newLabels.ContainsKey($newLabel)) {
            throw "Mapped new machine labels must be unique. Duplicate: '$newLabel'."
        }
        $newLabels[$newLabel] = $true
        $entries += [pscustomobject]@{ Old = $oldLabel; New = $newLabel }
    }

    return @($entries | Sort-Object @{ Expression = { $_.Old.Length }; Descending = $true }, Old)
}

function Get-MappedMachineLabel {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    foreach ($entry in $MapEntries) {
        if ($Label -ceq $entry.Old) {
            return $entry.New
        }
    }
    return $null
}

function Test-NewMachineLabel {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    foreach ($entry in $MapEntries) {
        if ($Label -ceq $entry.New) {
            return $true
        }
    }
    return $false
}

function ConvertTo-SanitizedString {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    $result = $Value
    foreach ($entry in $MapEntries) {
        $result = $result.Replace($entry.Old, $entry.New)
    }
    return $result
}

function ConvertTo-SanitizedJsonText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    $result = $Text
    foreach ($entry in $MapEntries) {
        $result = $result.Replace($entry.Old, $entry.New)
    }
    return $result
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$ChildPath
    )

    $root = (Get-Item -LiteralPath $RootPath).FullName.TrimEnd('\') + '\'
    $child = (Get-Item -LiteralPath $ChildPath).FullName
    $rootUri = New-Object System.Uri($root)
    $childUri = New-Object System.Uri($child)
    return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($childUri).ToString()).Replace('/', '\')
}

function Join-RootedRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    $result = $RootPath
    foreach ($segment in ($RelativePath -split '[\\/]')) {
        if ($segment.Length -gt 0) {
            $result = Join-Path $result $segment
        }
    }
    return $result
}

function Get-LatestTargetPath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$SourceFile,
        [Parameter(Mandatory = $true)][string]$NewMachineLabel,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    $suffix = "-latest.json"
    $prefix = $SourceFile.Name.Substring(0, $SourceFile.Name.Length - $suffix.Length)
    $sanitizedPrefix = ConvertTo-SanitizedString -Value $prefix -MapEntries $MapEntries
    if ([string]::IsNullOrWhiteSpace($sanitizedPrefix) -or $sanitizedPrefix -ceq $prefix) {
        $sanitizedPrefix = $NewMachineLabel
    }
    return Join-Path $RootPath "$sanitizedPrefix$suffix"
}

function Get-ArchiveTargetPath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$SourceFilePath,
        [Parameter(Mandatory = $true)][string]$NewMachineLabel,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    $relative = Get-RelativePath -RootPath $RootPath -ChildPath $SourceFilePath
    $segments = @($relative -split '[\\/]' | Where-Object { $_.Length -gt 0 })
    for ($i = 0; $i -lt $segments.Count; $i += 1) {
        $segments[$i] = ConvertTo-SanitizedString -Value $segments[$i] -MapEntries $MapEntries
    }
    if ($segments.Count -ge 3 -and $segments[0] -ceq "archive") {
        $segments[1] = $NewMachineLabel
    }
    return Join-RootedRelativePath -RootPath $RootPath -RelativePath ([string]::Join('\', $segments))
}

function Read-JsonText {
    param([Parameter(Mandatory = $true)][string]$Path)

    return Get-Content -Raw -LiteralPath $Path
}

function ConvertFrom-JsonText {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Path
    )

    try {
        return ConvertFrom-Json -InputObject $Text
    } catch {
        throw "Failed to parse JSON file '$Path': $($_.Exception.Message)"
    }
}

function Invoke-NodeJsonValidation {
    param(
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$ExpectedMachineLabel,
        [string]$DisplayPath
    )

    $node = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $node) {
        return @("Node.js was not found on PATH; cannot run PromptFuel-compatible JSON schema validation.")
    }

    $expectedArg = if ($ExpectedMachineLabel) { $ExpectedMachineLabel } else { "__NO_EXPECTED__" }
    $displayArg = if ($DisplayPath) { $DisplayPath } else { $Path }
    $output = & $node.Source -e $NodeValidatorScript $Kind $Path $expectedArg $displayArg 2>&1
    if ($LASTEXITCODE -ne 0) {
        return @($output | ForEach-Object { [string]$_ })
    }
    return @()
}

function Get-SourceIdsFromLatestFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $node = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $node) {
        return @()
    }

    $output = & $node.Source -e $NodeSourceIdScript $Path 2>&1
    if ($LASTEXITCODE -ne 0) {
        return @()
    }
    return @($output | ForEach-Object { [string]$_ })
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    return ConvertFrom-JsonText -Text (Read-JsonText -Path $Path) -Path $Path
}

function Test-HasJsonProperty {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string]$Name
    )

    return $null -ne $Json.PSObject.Properties[$Name]
}

function Get-JsonPropertyValue {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $prop = $Json.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $null
    }
    return $prop.Value
}

function Get-JsonMachineLabel {
    param([Parameter(Mandatory = $true)]$Json)

    $value = Get-JsonPropertyValue -Json $Json -Name "machineLabel"
    if ($value -isnot [string]) {
        return $null
    }
    return [string]$value
}

function Test-JsonObject {
    param([AllowNull()]$Value)
    return $Value -is [System.Management.Automation.PSCustomObject]
}

function Test-JsonArray {
    param([AllowNull()]$Value)
    return $Value -is [System.Array]
}

function Test-JsonNumber {
    param([AllowNull()]$Value)

    if ($Value -is [bool] -or $null -eq $Value) {
        return $false
    }
    if ($Value -isnot [byte] -and $Value -isnot [int16] -and $Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [single] -and $Value -isnot [double] -and $Value -isnot [decimal]) {
        return $false
    }
    $number = [double]$Value
    return -not [double]::IsNaN($number) -and -not [double]::IsInfinity($number)
}

function Add-ValidationError {
    param(
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Message
    )

    [void]$Errors.Add("$($Path): $Message")
}

function Test-OnlyAllowedKeys {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string[]]$Allowed,
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Location
    )

    foreach ($prop in @($Json.PSObject.Properties)) {
        if (-not ($Allowed -contains $prop.Name)) {
            Add-ValidationError -Errors $Errors -Path $Path -Message "$Location has unsupported field '$($prop.Name)'"
        }
    }
}

function Test-OptionalNumberField {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string]$Name,
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Location
    )

    if ((Test-HasJsonProperty -Json $Json -Name $Name) -and -not (Test-JsonNumber (Get-JsonPropertyValue -Json $Json -Name $Name))) {
        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.$Name must be a number when present"
    }
}

function Test-HistoryBucket {
    param(
        [Parameter(Mandatory = $true)]$Bucket,
        [string]$Month,
        [System.Collections.Generic.List[string]]$Errors,
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Location
    )

    if (-not (Test-JsonObject $Bucket)) {
        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location must be an object"
        return
    }

    Test-OnlyAllowedKeys -Json $Bucket -Allowed $BucketFields -Errors $Errors -Path $Path -Location $Location
    $dateKey = Get-JsonPropertyValue -Json $Bucket -Name "dateKey"
    if ($dateKey -isnot [string] -or [string]::IsNullOrWhiteSpace($dateKey)) {
        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.dateKey must be a non-empty string"
    } elseif ($Month -and -not [regex]::IsMatch($dateKey, "^$([regex]::Escape($Month))-\d{2}$")) {
        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.dateKey must be inside archive month '$Month'"
    }

    foreach ($field in @("inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "requests", "messages", "turns")) {
        Test-OptionalNumberField -Json $Bucket -Name $field -Errors $Errors -Path $Path -Location $Location
    }

    if ((Test-HasJsonProperty -Json $Bucket -Name "sourceConfidence") -and (Get-JsonPropertyValue -Json $Bucket -Name "sourceConfidence") -isnot [string]) {
        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.sourceConfidence must be a string when present"
    }

    if (Test-HasJsonProperty -Json $Bucket -Name "models") {
        $models = Get-JsonPropertyValue -Json $Bucket -Name "models"
        if (-not (Test-JsonArray $models)) {
            Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.models must be an array when present"
        } else {
            $index = 0
            foreach ($model in @($models)) {
                if (-not (Test-JsonObject $model)) {
                    Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.models[$index] must be an object"
                } else {
                    Test-OnlyAllowedKeys -Json $model -Allowed $ModelFields -Errors $Errors -Path $Path -Location "$Location.models[$index]"
                    $modelName = Get-JsonPropertyValue -Json $model -Name "model"
                    if ($modelName -isnot [string] -or [string]::IsNullOrWhiteSpace($modelName)) {
                        Add-ValidationError -Errors $Errors -Path $Path -Message "$Location.models[$index].model must be a non-empty string"
                    }
                    foreach ($field in @("inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "reasoningOutputTokens", "requests", "messages", "turns")) {
                        Test-OptionalNumberField -Json $model -Name $field -Errors $Errors -Path $Path -Location "$Location.models[$index]"
                    }
                }
                $index += 1
            }
        }
    }
}

function Test-LatestSnapshotPayload {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$ExpectedMachineLabel
    )

    $errors = New-Object 'System.Collections.Generic.List[string]'
    if (-not (Test-JsonObject $Json)) {
        Add-ValidationError -Errors $errors -Path $Path -Message "latest snapshot must be a JSON object"
        return $errors
    }

    Test-OnlyAllowedKeys -Json $Json -Allowed $LatestRootFields -Errors $errors -Path $Path -Location "latest snapshot"
    if ((Get-JsonPropertyValue -Json $Json -Name "schemaVersion") -ne $SnapshotSchemaVersion) {
        Add-ValidationError -Errors $errors -Path $Path -Message "schemaVersion must be $SnapshotSchemaVersion"
    }
    if ((Get-JsonPropertyValue -Json $Json -Name "writerVersion") -isnot [string] -or [string]::IsNullOrWhiteSpace((Get-JsonPropertyValue -Json $Json -Name "writerVersion"))) {
        Add-ValidationError -Errors $errors -Path $Path -Message "writerVersion must be a non-empty string"
    }
    if (-not (Test-JsonNumber (Get-JsonPropertyValue -Json $Json -Name "generatedAtEpochMs"))) {
        Add-ValidationError -Errors $errors -Path $Path -Message "generatedAtEpochMs must be numeric"
    }

    $machineLabel = Get-JsonMachineLabel -Json $Json
    if (-not $machineLabel) {
        Add-ValidationError -Errors $errors -Path $Path -Message "machineLabel must be a non-empty string"
    } elseif ($ExpectedMachineLabel -and $machineLabel -cne $ExpectedMachineLabel) {
        Add-ValidationError -Errors $errors -Path $Path -Message "machineLabel '$machineLabel' did not match expected '$ExpectedMachineLabel'"
    }

    if (Test-HasJsonProperty -Json $Json -Name "providerUsage") {
        $providerUsage = Get-JsonPropertyValue -Json $Json -Name "providerUsage"
        if (-not (Test-JsonArray $providerUsage)) {
            Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage must be an array when present"
        } else {
            $index = 0
            foreach ($provider in @($providerUsage)) {
                if (-not (Test-JsonObject $provider)) {
                    Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index] must be an object"
                } else {
                    Test-OnlyAllowedKeys -Json $provider -Allowed $ProviderFields -Errors $errors -Path $Path -Location "providerUsage[$index]"
                    $providerName = Get-JsonPropertyValue -Json $provider -Name "provider"
                    if (-not ($ProviderNames -contains $providerName)) {
                        Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].provider must be claude or codex"
                    }
                    if ((Get-JsonPropertyValue -Json $provider -Name "sourceLabel") -isnot [string]) {
                        Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].sourceLabel must be a string"
                    }
                    if ((Get-JsonPropertyValue -Json $provider -Name "stale") -isnot [bool]) {
                        Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].stale must be boolean"
                    }
                    if (-not ($ProviderSources -contains (Get-JsonPropertyValue -Json $provider -Name "source"))) {
                        Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].source is not supported"
                    }
                    if (-not ($SourceConfidences -contains (Get-JsonPropertyValue -Json $provider -Name "sourceConfidence"))) {
                        Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].sourceConfidence is not supported"
                    }
                    foreach ($field in @("fiveHourUsedPercent", "sevenDayUsedPercent", "fiveHourResetAtEpochSeconds", "sevenDayResetAtEpochSeconds", "lastUpdatedEpochMs")) {
                        Test-OptionalNumberField -Json $provider -Name $field -Errors $errors -Path $Path -Location "providerUsage[$index]"
                    }
                    if (Test-HasJsonProperty -Json $provider -Name "historyBuckets") {
                        $historyBuckets = Get-JsonPropertyValue -Json $provider -Name "historyBuckets"
                        if (-not (Test-JsonArray $historyBuckets)) {
                            Add-ValidationError -Errors $errors -Path $Path -Message "providerUsage[$index].historyBuckets must be an array when present"
                        } else {
                            $bucketIndex = 0
                            foreach ($bucket in @($historyBuckets)) {
                                Test-HistoryBucket -Bucket $bucket -Errors $errors -Path $Path -Location "providerUsage[$index].historyBuckets[$bucketIndex]"
                                $bucketIndex += 1
                            }
                        }
                    }
                }
                $index += 1
            }
        }
    }

    return $errors
}

function Test-ArchivePayload {
    param(
        [Parameter(Mandatory = $true)]$Json,
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$ExpectedMachineLabel
    )

    $errors = New-Object 'System.Collections.Generic.List[string]'
    if (-not (Test-JsonObject $Json)) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive payload must be a JSON object"
        return $errors
    }

    Test-OnlyAllowedKeys -Json $Json -Allowed $ArchiveRootFields -Errors $errors -Path $Path -Location "archive"
    if ((Get-JsonPropertyValue -Json $Json -Name "schemaVersion") -ne $SnapshotSchemaVersion) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive schemaVersion must be $SnapshotSchemaVersion"
    }
    if ((Get-JsonPropertyValue -Json $Json -Name "archiveSchemaVersion") -ne $ArchiveSchemaVersion) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archiveSchemaVersion must be $ArchiveSchemaVersion"
    }
    if (-not (Test-JsonNumber (Get-JsonPropertyValue -Json $Json -Name "generatedAtEpochMs"))) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive generatedAtEpochMs must be numeric"
    }
    if ((Get-JsonPropertyValue -Json $Json -Name "writerVersion") -isnot [string] -or [string]::IsNullOrWhiteSpace((Get-JsonPropertyValue -Json $Json -Name "writerVersion"))) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive writerVersion must be a non-empty string"
    }

    $machineLabel = Get-JsonMachineLabel -Json $Json
    if (-not $machineLabel) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive machineLabel must be a non-empty string"
    } elseif ($ExpectedMachineLabel -and $machineLabel -cne $ExpectedMachineLabel) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive machineLabel '$machineLabel' did not match expected '$ExpectedMachineLabel'"
    }

    $month = Get-JsonPropertyValue -Json $Json -Name "month"
    if ($month -isnot [string] -or -not [regex]::IsMatch($month, '^\d{4}-\d{2}$')) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive month must be YYYY-MM"
    }

    $providers = Get-JsonPropertyValue -Json $Json -Name "providers"
    if (-not (Test-JsonArray $providers)) {
        Add-ValidationError -Errors $errors -Path $Path -Message "archive providers must be an array"
    } else {
        $index = 0
        foreach ($provider in @($providers)) {
            if (-not (Test-JsonObject $provider)) {
                Add-ValidationError -Errors $errors -Path $Path -Message "archive providers[$index] must be an object"
            } else {
                Test-OnlyAllowedKeys -Json $provider -Allowed $ArchiveProviderFields -Errors $errors -Path $Path -Location "archive providers[$index]"
                if (-not ($ProviderNames -contains (Get-JsonPropertyValue -Json $provider -Name "provider"))) {
                    Add-ValidationError -Errors $errors -Path $Path -Message "archive providers[$index].provider must be claude or codex"
                }
                $historyBuckets = Get-JsonPropertyValue -Json $provider -Name "historyBuckets"
                if (-not (Test-JsonArray $historyBuckets)) {
                    Add-ValidationError -Errors $errors -Path $Path -Message "archive providers[$index].historyBuckets must be an array"
                } else {
                    $bucketIndex = 0
                    foreach ($bucket in @($historyBuckets)) {
                        Test-HistoryBucket -Bucket $bucket -Month $month -Errors $errors -Path $Path -Location "archive providers[$index].historyBuckets[$bucketIndex]"
                        $bucketIndex += 1
                    }
                }
            }
            $index += 1
        }
    }

    return $errors
}

function Get-SourceKind {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File
    )

    $relative = Get-RelativePath -RootPath $RootPath -ChildPath $File.FullName
    $segments = @($relative -split '[\\/]' | Where-Object { $_.Length -gt 0 })
    if ($segments.Count -eq 1 -and $File.Name.EndsWith("-latest.json", [System.StringComparison]::Ordinal)) {
        return "latest"
    }
    if ($segments.Count -ge 3 -and $segments[0] -ceq "archive") {
        return "archive"
    }
    return "skip"
}

function Get-SourceIdsFromLatestJson {
    param([Parameter(Mandatory = $true)]$Json)

    $machineLabel = Get-JsonMachineLabel -Json $Json
    if (-not $machineLabel) {
        return @()
    }

    $ids = @()
    $providerUsage = Get-JsonPropertyValue -Json $Json -Name "providerUsage"
    if (Test-JsonArray $providerUsage) {
        foreach ($provider in @($providerUsage)) {
            $providerName = Get-JsonPropertyValue -Json $provider -Name "provider"
            if ($providerName -is [string]) {
                $ids += "$machineLabel/$providerName"
            }
        }
    }
    return $ids
}

function Remove-ExistingSanitizedCopies {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][array]$MapEntries
    )

    $removed = 0
    $files = @(Get-ChildItem -LiteralPath $RootPath -Recurse -File -Filter *.json)
    foreach ($file in $files) {
        try {
            $json = Read-JsonFile -Path $file.FullName
        } catch {
            continue
        }

        $machineLabel = Get-JsonMachineLabel -Json $json
        if ($machineLabel -and (Test-NewMachineLabel -Label $machineLabel -MapEntries $MapEntries)) {
            Remove-Item -LiteralPath $file.FullName -Force
            $removed += 1
        }
    }
    return $removed
}

function Get-TitleLabel {
    param([Parameter(Mandatory = $true)][string]$Value)

    $words = @()
    foreach ($part in ($Value -split '[-_\s]+')) {
        if ($part.Length -eq 0) {
            continue
        }
        if ($part.Length -eq 1) {
            $words += $part.ToUpperInvariant()
        } else {
            $words += $part.Substring(0, 1).ToUpperInvariant() + $part.Substring(1).ToLowerInvariant()
        }
    }
    if ($words.Count -eq 0) {
        return $Value
    }
    return [string]::Join(' ', $words)
}

function Get-MachineInitial {
    param([Parameter(Mandatory = $true)][string]$Value)

    $match = [regex]::Match($Value, '[A-Za-z0-9]')
    if ($match.Success) {
        return $match.Value.ToUpperInvariant()
    }
    return "M"
}

function Write-SourcesSnippet {
    param([Parameter(Mandatory = $true)][string[]]$SourceIds)

    $sources = [ordered]@{
        claude = [ordered]@{ enabled = $true; label = "Claude"; shortLabel = "C"; statusBar = $true }
        codex = [ordered]@{ enabled = $true; label = "Codex"; shortLabel = "X"; statusBar = $true }
    }

    foreach ($sourceId in @($SourceIds | Sort-Object -Unique)) {
        $parts = $sourceId.Split('/')
        if ($parts.Count -ne 2) {
            continue
        }

        $machine = $parts[0]
        $provider = $parts[1]
        $providerTitle = Get-TitleLabel -Value $provider
        $machineTitle = Get-TitleLabel -Value $machine
        $providerInitial = if ($provider -ceq "claude") { "C" } elseif ($provider -ceq "codex") { "X" } else { $provider.Substring(0, 1).ToUpperInvariant() }
        $sources[$sourceId] = [ordered]@{
            enabled = $true
            label = "$providerTitle - $machineTitle"
            shortLabel = "$providerInitial$(Get-MachineInitial -Value $machine)"
            statusBar = $true
        }
    }

    Write-Host ""
    Write-Host "Suggested temporary settings snippet:"
    ([ordered]@{ "promptFuel.sources" = $sources }) | ConvertTo-Json -Depth 100
}

$mapEntries = Get-MachineMapEntries -Json $MachineMapJson

if ($SourcePath) {
    $pathSource = "explicit -SourcePath"
    $sourcePathValue = $SourcePath
} else {
    $pathSource = "settings: $SettingsPath"
    $sourcePathValue = Get-VsCodeSettingString -Path $SettingsPath -Name "promptFuel.snapshot.path"
}

$resolvedSourcePath = Get-ResolvedDirectory -Path $sourcePathValue
$removedCount = 0
if ($Force -or $Clean) {
    $removedCount = Remove-ExistingSanitizedCopies -RootPath $resolvedSourcePath -MapEntries $mapEntries
}

if ($Clean) {
    Write-Host "Resolved snapshot path: $resolvedSourcePath"
    Write-Host "Path source: $pathSource"
    Write-Host "Sanitized copies removed: $removedCount"
    Write-Host "Sanitized copies written: 0"
    exit 0
}

$jsonFiles = @(Get-ChildItem -LiteralPath $resolvedSourcePath -Recurse -File -Filter *.json)
$targets = @()
$preWriteErrors = New-Object 'System.Collections.Generic.List[string]'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($file in $jsonFiles) {
    $text = Read-JsonText -Path $file.FullName
    $json = ConvertFrom-JsonText -Text $text -Path $file.FullName
    $machineLabel = Get-JsonMachineLabel -Json $json
    if (-not $machineLabel) {
        continue
    }

    $newMachineLabel = Get-MappedMachineLabel -Label $machineLabel -MapEntries $mapEntries
    if (-not $newMachineLabel) {
        continue
    }

    $kind = Get-SourceKind -RootPath $resolvedSourcePath -File $file
    if ($kind -eq "skip") {
        continue
    }

    if ($kind -eq "latest") {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "latest" -Path $file.FullName -ExpectedMachineLabel $machineLabel)) {
            [void]$preWriteErrors.Add("Source latest validation failed: $err")
        }
        $targetPath = Get-LatestTargetPath -RootPath $resolvedSourcePath -SourceFile $file -NewMachineLabel $newMachineLabel -MapEntries $mapEntries
    } else {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "archive" -Path $file.FullName -ExpectedMachineLabel $machineLabel)) {
            [void]$preWriteErrors.Add("Source archive validation failed: $err")
        }
        $targetPath = Get-ArchiveTargetPath -RootPath $resolvedSourcePath -SourceFilePath $file.FullName -NewMachineLabel $newMachineLabel -MapEntries $mapEntries
    }

    if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
        if (-not $Force) {
            [void]$preWriteErrors.Add("Sanitized copy already exists. Re-run with -Force to replace it: $targetPath")
            continue
        }

        $existing = Read-JsonFile -Path $targetPath
        $existingLabel = Get-JsonMachineLabel -Json $existing
        if (-not $existingLabel -or -not (Test-NewMachineLabel -Label $existingLabel -MapEntries $mapEntries)) {
            [void]$preWriteErrors.Add("Refusing to replace non-sanitized target: $targetPath")
            continue
        }
        Remove-Item -LiteralPath $targetPath -Force
    }

    $sanitizedText = ConvertTo-SanitizedJsonText -Text $text -MapEntries $mapEntries
    $tempValidationPath = Join-Path ([System.IO.Path]::GetTempPath()) "PromptFuelSnapshot.$PID.$([guid]::NewGuid().ToString('N')).json"
    [System.IO.File]::WriteAllText($tempValidationPath, $sanitizedText, $utf8NoBom)
    if ($kind -eq "latest") {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "latest" -Path $tempValidationPath -ExpectedMachineLabel $newMachineLabel -DisplayPath $targetPath)) {
            [void]$preWriteErrors.Add("Generated latest validation failed before write: $err")
        }
    } else {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "archive" -Path $tempValidationPath -ExpectedMachineLabel $newMachineLabel -DisplayPath $targetPath)) {
            [void]$preWriteErrors.Add("Generated archive validation failed before write: $err")
        }
    }
    Remove-Item -LiteralPath $tempValidationPath -Force

    $targets += [pscustomobject]@{
        SourcePath = $file.FullName
        TargetPath = $targetPath
        Kind = $kind
        Text = $sanitizedText
        NewMachineLabel = $newMachineLabel
    }
}

if ($preWriteErrors.Count -gt 0) {
    Write-Host "PromptFuel-compatible validation errors:" -ForegroundColor Red
    foreach ($err in $preWriteErrors) {
        Write-Host "  $err"
    }
    exit 1
}

$writtenPaths = @()
$writtenLatestPaths = @()
$sourceIds = @()
$postWriteErrors = New-Object 'System.Collections.Generic.List[string]'

foreach ($target in $targets) {
    $directory = Split-Path -Parent $target.TargetPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    [System.IO.File]::WriteAllText($target.TargetPath, $target.Text, $utf8NoBom)
    $writtenPaths += $target.TargetPath

    if ($target.Kind -eq "latest") {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "latest" -Path $target.TargetPath -ExpectedMachineLabel $target.NewMachineLabel)) {
            [void]$postWriteErrors.Add("Generated latest validation failed after write: $err")
        }
        $writtenLatestPaths += $target.TargetPath
        $sourceIds += Get-SourceIdsFromLatestFile -Path $target.TargetPath
    } else {
        foreach ($err in (Invoke-NodeJsonValidation -Kind "archive" -Path $target.TargetPath -ExpectedMachineLabel $target.NewMachineLabel)) {
            [void]$postWriteErrors.Add("Generated archive validation failed after write: $err")
        }
    }
}

$remainingOldLabels = @()
foreach ($path in $writtenPaths) {
    $content = Get-Content -Raw -LiteralPath $path
    $relative = Get-RelativePath -RootPath $resolvedSourcePath -ChildPath $path
    $segments = $relative -split '[\\/]'

    foreach ($entry in $mapEntries) {
        if ($content.Contains($entry.Old)) {
            $remainingOldLabels += "content: $path contains '$($entry.Old)'"
        }
        foreach ($segment in $segments) {
            if ($segment.Contains($entry.Old)) {
                $remainingOldLabels += "path: $relative contains '$($entry.Old)'"
                break
            }
        }
    }
}

foreach ($latestPath in $writtenLatestPaths) {
    $parent = Split-Path -Parent $latestPath
    $name = Split-Path -Leaf $latestPath
    if (([System.IO.Path]::GetFullPath($parent)) -cne ([System.IO.Path]::GetFullPath($resolvedSourcePath))) {
        [void]$postWriteErrors.Add("Generated latest file is not at the snapshot root: $latestPath")
    }
    if (-not $name.EndsWith("-latest.json", [System.StringComparison]::Ordinal)) {
        [void]$postWriteErrors.Add("Generated latest file does not end with -latest.json: $latestPath")
    }
}

foreach ($item in $remainingOldLabels) {
    [void]$postWriteErrors.Add("Old mapped label remains in generated copy: $item")
}

$sourceIds = @($sourceIds | Sort-Object -Unique)

Write-Host "Resolved snapshot path: $resolvedSourcePath"
Write-Host "Path source: $pathSource"
Write-Host "Source JSON files scanned: $($jsonFiles.Count)"
Write-Host "Existing sanitized copies removed: $removedCount"
Write-Host "Sanitized copies written: $($writtenPaths.Count)"
Write-Host "Generated top-level latest files:"
if ($writtenLatestPaths.Count -gt 0) {
    foreach ($path in @($writtenLatestPaths | Sort-Object)) {
        Write-Host "  $path"
    }
} else {
    Write-Host "  (none)"
}
Write-Host "Generated source IDs:"
if ($sourceIds.Count -gt 0) {
    foreach ($sourceId in $sourceIds) {
        Write-Host "  $sourceId"
    }
} else {
    Write-Host "  (none)"
}

if ($postWriteErrors.Count -gt 0) {
    Write-Host ""
    Write-Host "PromptFuel-compatible validation errors:" -ForegroundColor Red
    foreach ($err in $postWriteErrors) {
        Write-Host "  $err"
    }
    exit 1
}

Write-Host "Old mapped labels remain in generated copies: no"
Write-Host "Generated latest/archive schema checks: pass"
Write-SourcesSnippet -SourceIds $sourceIds
