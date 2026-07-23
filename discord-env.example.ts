import type { Environment } from './src/types';

const env: Environment = {
    "token": "your-token",
    "app_id": "your-app-id",
    "clientOptions": {
        "intents": [
            "Guilds",
            "GuildMembers",
            "GuildModeration",
            "GuildExpressions",
            "GuildIntegrations",
            "GuildWebhooks",
            "GuildInvites",
            "GuildVoiceStates",
            "GuildPresences",
            "GuildMessages",
            "GuildMessageReactions",
            "GuildMessageTyping",
            "DirectMessages",
            "DirectMessageReactions",
            "DirectMessageTyping",
            "MessageContent",
            "GuildScheduledEvents",
            "AutoModerationConfiguration",
            "AutoModerationExecution",
            "GuildMessagePolls",
            "DirectMessagePolls"
        ]
    },
    "restOptions": {
        "version": "10"
    }
};

export default env;
