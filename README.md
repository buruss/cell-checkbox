# Cell Checkbox

Obsidian 플러그인 — 마크다운 **표 셀 안의** `[ ]` / `[O]` 를 탭/클릭만으로 토글한다. 모바일·태블릿에서 가상 키보드 없이 검토 시트류 문서를 빠르게 체크할 때 쓰는 용도.

## 사용 예

```markdown
| 단원       | 검토  | 비고  |
| -------- | :-: | --- |
| 1. 개요     | [O] |     |
| 2. 본문     | [ ] |     |
| 3. 결론     | [ ] |     |
```

- Reading view / Live Preview에서 `[ ]`, `[O]` 위치에 작은 체크박스가 표시됨
- 탭하면 `[ ]` ↔ `[O]` 토글 (파일이 즉시 저장됨)
- 모바일에서는 위젯을 탭해도 가상 키보드가 열리지 않음

## 동작 원리

이 플러그인은 **두 개의 독립된 렌더링 경로**를 가짐:

### Reading view
- `registerMarkdownPostProcessor` 로 렌더된 `<td>`/`<th>` 안의 텍스트 노드와 native `<input type="checkbox">` 를 모두 위젯 `<span>` 으로 치환 (단, `<code>`/`<pre>` 내부는 제외)
- 클릭 시 **행 fingerprint**(`<tr>` 셀 텍스트 join) + 셀 내 매치 인덱스로 소스 라인을 찾아 `app.vault.process()` 로 atomic 수정

### Live Preview (편집 모드)
- CodeMirror 6 `ViewPlugin` 으로 표 라인의 `[ ]`/`[<설정 문자>]` 패턴을 `Decoration.replace` + 위젯으로 치환
- 커서가 올라간 행은 위젯 대신 raw 소스로 보여줘 직접 편집 가능
- `editorLivePreviewField` 로 Source mode 에서는 위젯을 만들지 않음 → 원본 보기 모드에서는 `[O]` 텍스트 그대로 표시
- 클릭 시 `view.dispatch({changes})` 로 토글

### 공통: 모바일 가상 키보드 차단
- `pointerdown` / `mousedown` / `touchstart` 에서 `preventDefault()` → CodeMirror 가 contenteditable 에 포커스를 잡지 못하게 막음
- 위젯에 `contenteditable="false"` 추가

## 빌드 & 설치 (수동)

```bash
pnpm install
pnpm approve-builds   # pnpm 11+ 에서 esbuild postinstall 1회 승인
pnpm run build
```

> pnpm 11 이상은 의존성의 build script(여기선 esbuild의 플랫폼 바이너리 다운로드)를
> 명시 승인해야 한다. `pnpm approve-builds` 한 번만 실행하면 이후엔 자동 동작.
> npm 사용자는 `npm install && npm run build` 로 충분.

빌드 결과물(`main.js`, `manifest.json`, `styles.css`)을 vault의
`.obsidian/plugins/cell-checkbox/` 디렉토리로 복사한 뒤 Obsidian → Settings → Community plugins 에서 활성화.

개발 중에는 vault의 플러그인 폴더에 본 디렉토리를 심볼릭 링크로 연결하면 편함:

```powershell
# Windows (관리자 PowerShell)
New-Item -ItemType Junction `
  -Path "<vault>\.obsidian\plugins\cell-checkbox" `
  -Target "D:\obsidian-plugins\cell-checkbox"
```

```bash
pnpm run dev   # watch mode
```

## 설정

Obsidian → Settings → Community plugins → **Cell Checkbox** 에서 변경 가능:

- **Checked character** — 체크 상태일 때 대괄호 안에 들어가는 문자 (기본 `O`).
  - `O` (기본): `[O]` / `[ ]` 토글
  - `x`: Markdown 표준 태스크 리스트 형식 (`[x]` / `[ ]`)
  - 그 외 단일 문자도 입력 가능 (단, `[`, `]`, `\`, 공백은 금지)

설정 변경 시 열려 있는 노트는 자동으로 다시 렌더됨. 단, 기존 파일에 다른 문자(예: 예전 `[O]`)가 남아 있으면 그 문자는 더 이상 인식되지 않으므로 일괄 변환이 필요할 수 있음.

## 제약

- 토글은 정확히 `[ ]` (브래킷 - 스페이스 - 브래킷) ↔ `[<설정 문자>]` 만 다룸 (대소문자 구분)
- 셀 안에 `**[O]**` 같은 마크다운 강조가 섞이면 fingerprint 매칭이 어긋날 수 있음 (plain text 가정)
- Live Preview 에서 커서가 표 위에 있어 active 행이 소스 모드로 보일 때, 다른 행의 위젯은 정상 작동
