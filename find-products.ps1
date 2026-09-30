$urls = @(
  'https://blackout-market-ot.mysellauth.com/',
  'https://blackout-market-ot.mysellauth.com/products'
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing
    Write-Output "URL $u LEN $($r.Content.Length)"
    $m = [regex]::Matches($r.Content, 'product/[a-z0-9\-]+')
    $m | ForEach-Object { $_.Value } | Select-Object -Unique
  } catch {
    Write-Output $_.Exception.Message
  }
}
