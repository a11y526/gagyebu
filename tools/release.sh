#!/bin/zsh
# 웹앱 올리기: ./tools/release.sh "바꾼 내용"
# index.html의 ?v=숫자와 version.txt를 하나 올려서, 열려 있는 앱(아이폰 홈 화면·갤럭시 앱)이 새 버전을 알아채게 한다.
set -e
cd ${0:A:h:h}
cur=$(grep -o '?v=[0-9]*' index.html | head -1 | cut -c4-)
next=$((cur + 1))
sed -i '' "s/?v=$cur/?v=$next/g" index.html
print -n $next > version.txt
git add -A
git -c user.name="a11y526" -c user.email="$(git -C ../과학1/class-portal config user.email 2>/dev/null || echo a11y526@users.noreply.github.com)" commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
echo "올림: 버전 $next"
