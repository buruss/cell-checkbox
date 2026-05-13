# 작업 디렉토리 깨끗한지 확인 (clean state 에서만 동작)

git status

# 한 줄로 버전 bump + manifest 동기화 + commit + tag 까지

pnpm version 0.1.1

# 푸시

git push origin main --follow-tags

--follow-tags 가 main 과 함께 새 tag 도 같이 push 해서 Actions 트리거.

b
