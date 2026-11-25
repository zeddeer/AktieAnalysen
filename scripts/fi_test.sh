#!/bin/bash
# Tillfällig felsökning av FI:s filnedladdning
U=https://www.fi.se/BlankningsRegister/GetHistFile
B="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
for i in 1 2; do
  echo "T default: $(curl -s -o /tmp/a -w '%{http_code} %{content_type} %{size_download}' $U)"
  echo "T browser: $(curl -s -o /tmp/b -w '%{http_code} %{content_type} %{size_download}' -A "$B" $U)"
  echo "T browser+accept: $(curl -s -o /tmp/c -w '%{http_code} %{content_type} %{size_download}' -A "$B" -H 'Accept: text/html,application/xhtml+xml,*/*;q=0.8' -H 'Accept-Language: sv-SE,sv;q=0.9' $U)"
  echo "T cookies: $(curl -s -c /tmp/j -b /tmp/j -o /dev/null -w '%{http_code}' -A "$B" https://www.fi.se/sv/vara-register/blankningsregistret/) $(curl -s -c /tmp/j -b /tmp/j -o /tmp/d -w '%{http_code} %{content_type} %{size_download}' -A "$B" -H 'X-Requested-With: XMLHttpRequest' $U)"
  echo "T http1.1: $(curl -s --http1.1 -o /tmp/e -w '%{http_code} %{content_type} %{size_download}' -A "$B" $U)"
  echo "T head: $(curl -sI -A "$B" $U | head -12 | tr -d '\r' | tr '\n' ' ')"
  echo "T en-page: $(curl -s -o /dev/null -w '%{http_code}' -A "$B" https://www.fi.se/en/our-registers/fis-marknadsregister/blankning/net-short-positions/)"
  sleep 3
done
