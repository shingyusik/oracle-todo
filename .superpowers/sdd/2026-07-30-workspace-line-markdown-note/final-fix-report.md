# Workspace Line Markdown Note Final Fix Report

## Status

최종 브랜치 리뷰의 Important 3건과 Minor 3건을 모두 수정했다. 기존
`value`/`onChange` 제어 계약, detail Save 경계, safe external link,
`skipHtml`, marker-only task 표시, checked-line 취소선은 유지했다.

## Finding별 해결

1. Marker-only checkbox 클릭
   - marker-only checkbox를 원문 기반 `readOnly`, `aria-disabled`, 비탭 상태로 유지했다.
   - checkbox click의 기본 토글은 막고 줄 click으로 전파해 해당 줄 편집을 연다.
   - checkbox 자체를 클릭하는 회귀 테스트를 추가했다.
2. IME 조합 Enter
   - `event.nativeEvent.isComposing`이면 Enter 줄 삽입을 건너뛴다.
   - 한글 조합 완료 Enter가 `onChange`를 호출하지 않는 회귀 테스트를 추가했다.
3. 중첩 interactive semantics
   - Markdown 본문에서 `role="button"`/`tabIndex`를 제거했다.
   - Markdown 본문과 네이티브 line edit button을 형제로 분리했다.
   - 본문 pointer click은 편집하고 link click은 링크로 유지한다.
   - 전용 버튼은 네이티브 Enter/Space 동작으로 편집한다.
   - heading/link/checkbox가 button 내부가 아님을 검증한다.
4. 첫/마지막 child margin
   - margin reset 범위를 `.markdown-note-line > :first-child`와
     `.markdown-note-line > :last-child`로 좁혔다.
5. 제거된 edit-button 규칙
   - `.markdown-note-edit-button` CSS와 architecture 원문 assertion을 제거했다.
   - 새 `.markdown-note-line-edit-button`은 실제 DOM/키보드 테스트로 검증하며
     새 CSS 원문 assertion은 추가하지 않았다.
6. 빈 노트 accessible name
   - 임의의 첫 button 대신 `Edit Markdown note line 1`을 명시적으로 검증한다.

## 변경 파일

- `frontend/src/features/workbench/ui/MarkdownNoteEditor.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/markdown-note-editor.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- `frontend/tests/architecture/design-boundaries.spec.ts`

## TDD RED / GREEN

- RED:
  `npm --prefix frontend test -- tests/presentation/markdown-note-editor.spec.tsx`
  - exit 1
  - 12 tests 중 6 failed / 6 passed
  - 실패 원인: 새 line edit accessible name 부재, IME Enter 줄 삽입,
    disabled checkbox 직접 클릭 미전파, Markdown semantics가 button 안에 중첩됨.
- GREEN:
  `npm --prefix frontend test -- tests/presentation/markdown-note-editor.spec.tsx tests/architecture/design-boundaries.spec.ts`
  - exit 0
  - 2 files, 33 tests passed.
- 영향 통합 RED:
  `npm --prefix frontend test`
  - 최초 exit 1, 443 tests 중 433 passed / 10 failed.
  - 제거된 본문 button accessible name을 조회하던 integration selector만 실패했다.
- 영향 통합 GREEN:
  `npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx`
  - selector 8건 갱신 후 176 tests 중 174 passed / 2 failed.
  - 남은 두 layout selector 갱신 후 전체 suite에서 함께 통과했다.

## 전체 검증

- `npm --prefix frontend test`
  - exit 0, 16 files / 443 tests passed.
- `npm --prefix frontend run typecheck`
  - exit 0.
- `npm --prefix frontend run build`
  - exit 0, Next.js optimized production build 및 4/4 static page 생성 성공.
- `git diff --check`
  - exit 0.

## 자체 검토

- line mutation은 계속 기존 `onChange`만 호출하며 persistence API를 건드리지 않는다.
- 링크는 기존 `_blank`, `noreferrer noopener`, click propagation 차단을 유지한다.
- raw HTML은 계속 `skipHtml`로 렌더하지 않는다.
- `- [ ]`, `- [x]`, `- [X]`와 checked-line class 경로를 유지한다.
- 키보드 편집은 별도 native button에만 맡겨 heading/link/checkbox 의미를 보존한다.
- 새 의존성, CSS 원문 assertion, speculative abstraction은 추가하지 않았다.

## 우려

없음. marker-only checkbox는 네이티브 토글 대상이 아니라 Markdown 원문의 읽기 전용
표시이므로 `aria-disabled`와 `tabIndex={-1}`로 노출하며, 직접 클릭은 줄 편집으로만
전환된다.
