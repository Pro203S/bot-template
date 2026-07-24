# bot-template

[GitHub에서 보기](https://github.com/Pro203S/bot-template/blob/main/README.md)
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

커맨드 모듈은 **슬래시 커맨드, 메시지 컨텍스트 메뉴, 유저 컨텍스트 메뉴, 주 진입점** 커맨드를 핸들할 수 있습니다.  
모듈 타입은 튜플로 이루어져있습니다.  

|인덱스|설명|
|-|-|
|0|명령어 타입 ("slash" \| "messageContextMenu" \| "userContextMenu" \| "primaryEntry")|
|1|명령어 정보|
|2|명령어 콜백|

콜백의 인수에는 다음 타입의 Object가 들어옵니다.  
|이름|타입|설명|
|-|-|-|
|client|Client<true>|Ready 상태의 클라이언트|
|rest|REST|discord.js의 REST|
|interaction|Interaction|discord.js 상호작용 (명령어 타입에 맞는 상호작용이 제공됩니다)|

예시 코드:
```typescript
import { defineCommand } from "types";

const module = defineCommand([
    "slash",
    {
        "description": "퐁"
    },
    async ({ interaction }) => {
        await interaction.reply("퐁");
    }
]);

export default module;
```

## 이벤트 모듈

이벤트 모듈은 **모든 클라이언트 이벤트**를 핸들할 수 있습니다.  
모듈 타입은 튜플로 이루어져있습니다.  
(`Client.on` 또는 `Client.once`랑 같은 역할을 합니다)  

|인덱스|설명|
|-|-|
|0|이벤트 이름|
|1|이벤트 콜백|

콜백의 인수에는 다음 타입의 Object가 들어옵니다.  
|이름|타입|설명|
|-|-|-|
|client|Client<true>|Ready 상태의 클라이언트|
|rest|REST|discord.js의 REST|
|eventArgs|Array|이벤트가 발생되었을 때 값|

이벤트 모듈은 `once`라는 이름을 가진 `boolean` 값을 내보낼 수 있습니다.  
이 값을 내보내면 한 번만 실행됩니다.  

예시 코드:
```typescript
import { defineEvent } from "types";

// 한 번만 실행
export const once = true;

const module = defineEvent([
    "messageCreate",
    async ({ eventArgs: [message] }) => {
        console.log(message.content);
    }
]);

export default module;
```

## 상호작용 모듈

상호작용 모듈은 **커맨드 상호작용을 제외한 모든 상호작용**을 핸들할 수 있습니다.  
모듈 타입은 튜플로 이루어져있습니다.  

|인덱스|설명|
|-|-|
|0|상호작용 이름|
|1|상호작용 콜백|

콜백의 인수에는 다음 타입의 Object가 들어옵니다.  
|이름|타입|설명|
|-|-|-|
|client|Client<true>|Ready 상태의 클라이언트|
|rest|REST|discord.js의 REST|
|interaction|Interaction|discord.js의 상호작용|

상호작용 모듈은 `customId`라는 이름을 가진 `string`을 **무조건** 내보내야합니다.
이 값은 버튼, 선택 메뉴 등을 식별하기 위해 사용됩니다.  
`customId`는 와일드카드를 지원합니다.  
자동완성 상호작용의 경우엔 커맨드 이름을 작성해야합니다.

예시 코드:
```typescript
import { defineInteraction } from "types";

// 상호작용을 식별하기 위한 customId
export const customId = "button-*";

const module = defineInteraction([
    "button",
    async ({ interaction }) => {
        await interaction.reply("버튼 누름");
    }
]);

export default module;
```

## 커스텀 모듈

커스텀 모듈은 **봇과 프로세스의 lifecycle 이벤트**를 핸들할 수 있습니다.  
모듈 타입은 튜플로 이루어져있습니다.  

|인덱스|설명|
|-|-|
|0|커스텀 이벤트 이름|
|1|커스텀 이벤트 콜백|

콜백의 인수에는 다음 타입의 Object가 들어옵니다.  
|이름|타입|설명|
|-|-|-|
|client|Client<true>|Ready 상태의 클라이언트|
|rest|REST|discord.js의 REST|
|error|unknown|`error` 이벤트에서 전달되는 오류|
|message|string|`djsDebug`, `djsWarn`, `djsError` 이벤트의 메시지|
|code|number|`exit` 이벤트의 종료 코드|

|이벤트|실행 시점|
|-|-|
|ready|봇이 준비되었거나 커스텀 모듈이 hot reload 되었을 때|
|error|모듈 콜백 또는 처리되지 않은 런타임 오류가 발생했을 때|
|djsDebug|Discord.js의 `debug` 이벤트가 발생했을 때|
|djsWarn|Discord.js의 `warn` 이벤트가 발생했을 때|
|djsError|Discord.js의 `error` 이벤트가 발생했을 때|
|exit|프로세스가 종료될 때|

커스텀 모듈은 `once`라는 이름을 가진 `boolean` 값을 내보낼 수 있습니다.  
이 값을 내보내면 한 번만 실행됩니다.  
`exit` 콜백에서는 비동기 작업의 완료가 보장되지 않습니다.  

예시 코드:
```typescript
import { defineCustom } from "types";

const module = defineCustom([
    "ready",
    ({ client }) => {
        console.log(`${client.user.username} 준비 완료`);
    }
]);

export default module;
```

## 라이브러리 폴더

이 폴더는 `index.ts`에서 건드리지 않습니다.  
커맨드 모듈, 커스텀 모듈 등등 다른 파일에서 사용할 수 있는 유틸 모듈을 저장하는 폴더입니다.  
`modules/*`로 가져올 수 있습니다.

예시:
```typescript
// src/modules/sum.ts

export default function sum(a: number, b: number) {
    return a + b;
}
```

```typescript
import sum from 'modules/sum';

sum(1 + 2); // 3
```
