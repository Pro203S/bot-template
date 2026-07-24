# bot-template

[discord.js](https://discord.js.org/)와 Bun, TypeScript 기반 디스코드 봇 템플릿

## 주요 기능

- 파일과 폴더 구조를 이용한 Discord 커맨드 자동 라우팅
- commands, events, interactions, customs의 프로세스 재시작 없는 hot reload
- Discord.js 이벤트, interaction, 봇 lifecycle을 분리하는 모듈 시스템

## 사용법

1. `git clone https://github.com/Pro203S/bot-template <프로젝트명>`
2. `cd <프로젝트명>`
3. `bun initialize.js`

## 디렉토리 구조

```
/
├── src/
│   ├── commands
│   ├── customs
│   ├── events
│   ├── interactions
│   └── modules
└── discord-env.ts
```

|디렉토리|설명|
|-|-|
|[src/commands](#커맨드-모듈)|커맨드 모듈 폴더|
|[src/customs](#커스텀-모듈)|커스텀 모듈 폴더|
|[src/events](#이벤트-모듈)|이벤트 모듈 폴더|
|[src/interactions](#상호작용-모듈)|상호작용 모듈 폴더|
|[src/modules](#라이브러리-폴더)|다른 모듈에서 쓰는 라이브러리 폴더|
|[discord-env.ts](#discord-envts)|환경 파일 **절대 커밋되어선 안됩니다!**|

## discord-env.ts

.env 파일과 똑같은 역할을 합니다.  
dotenv를 써도 되지만, discord.js의 ClientOptions, RESTOptions를 커버하기 위해 따로 모듈을 만들었습니다.

> [!CAUTION]
> 이 파일은 봇의 토큰이 들어가는 파일이기 때문에 절대 커밋되어선 안됩니다!

이 모듈은 아래 타입을 가진 Object를 기본으로 내보내야합니다.

|키|타입|설명|
|-|-|-|
|token|string|봇의 토큰|
|app_id|string|애플리케이션 ID|
|environments|Record<string, string>|env 값 (process.env에 저장됨)|
|clientOptions|ClientOptions|discord.js에서 사용할 클라이언트 옵션|
|restOptions|Partial<RESTOptions>|discord.js REST에서 사용할 옵션|

예시 코드:
```typescript
import type { Environment } from './src/types';

const env: Environment = {
    "token": "your-token",
    "app_id": "your-app-id",
    "environments": {
        "SAMPLE_VALUE": "sample"
    },
    "clientOptions": {
        "intents": [
            "Guilds"
        ]
    },
    "restOptions": {
        "version": "10"
    }
};

export default env;
```

## 커맨드 모듈

## 커스텀 모듈

## 이벤트 모듈

## 상호작용 모듈

## 라이브러리 폴더

이 폴더는 `index.ts`에서 건드리지 않습니다.  
커맨드 모듈, 커스텀 모듈 등등 다른 파일에서 사용할 수 있는 유틸 모듈을 저장하는 폴더입니다.  
