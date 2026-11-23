# 팀 스튜디오 운영

## 로컬 실행

Node.js 22.13 이상이 필요합니다. `npm run dev`와 `npm start`는 127.0.0.1에 바인딩합니다. Supabase 환경 변수 없이 실행하면 현재 컴퓨터의 관리자 계정으로 열립니다. 프로젝트와 파일은 `.clamoa/studio.sqlite`에 저장됩니다. 이 경로는 `STUDIO_DATA_DIR`로 변경할 수 있습니다. 서버가 실행 중인 동안은 SQLite 백업 명령으로 백업하거나, 서버와 워커를 정지한 뒤 폴더 전체를 복사하세요. 개발 서버를 로컬 모드로 포트 포워딩하거나 외부에 프록시하지 마세요.

## 팀 서버 연결

운영용 Supabase 프로젝트와 공개 HTTPS 배포 주소가 준비되면 아래 명령으로 DB, 초기 관리자, 메일 설정을 적용할 수 있습니다.

1. 앱 서버용 값은 `.env.local` 또는 호스트의 서버 환경 변수에 설정합니다. OpenAI 키는 [OpenAI Platform 프로젝트 키](https://platform.openai.com/api-keys), Supabase 서버 키는 해당 프로젝트의 **Connect / API Keys**에서 가져옵니다.
2. 로컬 관리 명령에만 필요한 값은 권한을 제한한 `.env.setup.local`에 저장합니다. 템플릿은 [관리 명령 환경 변수](../.env.setup.example)에 있습니다. SMTP는 이미 설정되어 있으면 그대로 사용합니다. 새로 설정할 경우 발신 주소와 도메인은 SMTP 제공 서비스에서 인증하고 인증 메일의 링크 추적을 끕니다.
3. 지정한 프로젝트에 설정을 적용하고 점검합니다. 기존 인증 설정을 공유하는 프로젝트라면 아래 자동 적용 대신 하단의 수동 설정을 검토하세요. 자동 적용은 프로젝트의 사이트 주소와 확인·로그인·초대 메일 템플릿을 클라모아용으로 갱신합니다.

```sh
npm run check:connections -- --apply-team
npm run check:connections
npm run check:connections -- --smoke-openai
```

기본 점검은 모델 접근, Auth, DB 테이블, 비공개 버킷과 메일 설정을 조회합니다. `--apply-team`은 DB 마이그레이션과 관리자·메일 설정을 적용합니다. `--smoke-openai`는 실제 OpenAI 리서치와 이미지 한 컷을 요청하므로 API 사용량이 발생합니다. 생성 파일은 로컬 `.clamoa/check/`에 보관합니다. 운영 메일 확인은 배포 주소에서 최초 관리자 로그인 링크를 받고, 테스트할 팀원 한 명을 초대해 공유 프로젝트를 여는 순서로 진행합니다.

### 수동 설정

1. Supabase 프로젝트의 SQL Editor에서 [스튜디오 마이그레이션](../supabase/migrations/001_clamoa_studio.sql)을 실행합니다. 팀 작업 영역, 허용된 이메일 목록, 파일 정보 및 비공개 Storage 버킷이 만들어집니다.
2. 초기 관리자의 실제 이메일 주소로 아래 SQL을 한 번 실행합니다.
3. 웹 서버와 워커에 같은 Supabase 프로젝트 및 OpenAI 설정을 적용합니다. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STUDIO_SITE_URL`, `OPENAI_API_KEY`를 서버 환경 변수로 지정합니다. 키 변수는 Supabase의 대응하는 publishable/secret 키도 받습니다. `STUDIO_SITE_URL`은 외부에서 열 수 있는 HTTPS 스튜디오 주소입니다. 이 값들은 클라이언트 번들에 넣지 않습니다.
4. Supabase Authentication의 Site URL을 그 주소로 설정하고 허용 Redirect URL에 `https://스튜디오-도메인/api/auth/callback`을 추가합니다. 실제 팀 메일을 보내기 위해 발신 도메인과 SMTP를 설정합니다.
5. 아래 표대로 이메일 템플릿의 링크를 바꿉니다. 인증에는 서버의 이메일 검증과 허용 목록 확인이 모두 사용됩니다.
6. 저장소 루트에서 `npm ci && npm run build`를 실행합니다. 자체 호스팅에서는 HTTPS 리버스 프록시 뒤에서 `npx next start -H 0.0.0.0`를 실행합니다. 웹 서버와 워커의 작업 디렉터리에 `content`를 함께 배포합니다.
7. 관리자는 이메일 링크로 로그인한 후 팀원을 초대합니다. 팀원은 동일한 프로젝트를 편집·검수하고 관리자는 운영 워크플로우와 로고도 변경할 수 있습니다. 구성원 접근을 해지하려면 허용 목록에서 해당 이메일 행을 삭제합니다. 다음 API 요청부터 적용됩니다.

```sql
insert into public.clamoa_members (email, role)
values ('team-admin@example.com', 'admin')
on conflict (email) do update set role = excluded.role;
```

| Supabase 이메일 템플릿 | 링크 주소 |
| --- | --- |
| Confirm signup | `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=email` |
| Magic Link | `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=email` |
| Invite user | `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite` |

메일 링크는 확인 화면을 엽니다. 팀원이 **스튜디오에 로그인** 버튼을 눌렀을 때 이메일 토큰을 사용합니다. 메일 보안 스캐너의 자동 링크 조회로 토큰이 소진되는 일을 방지합니다.

## 생성 워커

Vercel 배포에서는 인증된 스튜디오 요청이 대기 작업을 시작합니다. 각 실행이 다음 대기 작업을 호출하므로 화면을 닫은 뒤에도 이어집니다. `CRON_SECRET`을 운영 환경에 설정하면 `vercel.json`의 일일 크론이 중단된 실행을 점검합니다.

자체 호스팅에서는 같은 버전의 코드와 서버 환경 변수로 `npm run worker`를 상시 실행합니다. 유휴 상태에서 4초마다 대기열을 확인하고, 종료 신호를 받으면 현재 작업을 마친 뒤 종료합니다. OpenAI 키가 없으면 대기열을 유지합니다. 로컬 모드에서는 웹 요청 후 내장 워커가 대기열을 처리합니다. 로컬 서버를 다시 시작하면 스튜디오에 재접속하거나 독립 워커를 실행해 이어갈 수 있습니다.

상시 프로세스를 사용하지 않는 배포는 `CRON_SECRET`을 지정하고 스케줄러에서 `Authorization: Bearer <CRON_SECRET>`과 함께 `GET /api/worker`를 호출합니다. 한 호출은 한 작업이 끝날 때까지 기다립니다. 호스트가 장시간 요청을 지원하는지 확인하세요. 대용량 원본은 서버 업로드 한도가 20MB이므로 배포 프록시가 허용하는 요청 크기도 확인해야 합니다.

대기열, 실행 권한, 결과 데이터는 같은 리비전 검사로 기록합니다. 중단된 작업의 실행 권한은 마지막 갱신 후 5분에 만료됩니다. 다음 워커가 해당 작업을 실패로 표시하면 스튜디오에서 기록을 확인하고 재시도하세요. 원격 이미지 생성 중 프로세스가 끊기면 API 과금 여부가 불확실해 자동으로 같은 작업을 재전송하지 않습니다. 데이터 복구용으로 Supabase 데이터베이스와 비공개 버킷을 함께 백업하세요.

Supabase 참고 문서 — [메일 템플릿](https://supabase.com/docs/guides/auth/auth-email-templates), [인증 링크 검증](https://supabase.com/docs/reference/javascript/auth-verifyotp), [비공개 파일 접근](https://supabase.com/docs/guides/storage/security/access-control).
