import definePlugin from "@utils/types";
import { FluxDispatcher, ChannelStore, GuildMemberStore, MessageActions, UserStore, GuildStore } from "@webpack/common";

let ws: WebSocket | null = null;
let lastSentId: string | null = null;

function connectWebSocket() {
    if (ws && ws.readyState !== WebSocket.CLOSED) return;
    
    ws = new WebSocket("ws://127.0.0.1:37485");
    
    ws.onopen = () => {};
    ws.onerror = () => {};
    ws.onclose = () => setTimeout(connectWebSocket, 5000);

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.action === "SEND_MESSAGE" && data.channelId && data.text) {
                MessageActions.sendMessage(
                    data.channelId,
                    {
                        content: data.text,
                        invalidEmojis: [],
                        validNonShortcutEmojis: [],
                        tts: false
                    },
                    undefined,
                    {}
                );
            }
        } catch (err) {}
    };
}

function processMessageAndSend(event: Record<string, any>, actionType: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const message = event.message || event;
    if (!message || !message.id) return;
    
    if (message.state === "SENDING" && actionType === "MESSAGE_CREATE") return;

    if (actionType === "MESSAGE_CREATE") {
        if (message.id === lastSentId) return;
        lastSentId = message.id;
    }

    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = channel?.guild_id;
    let roleColor = "#ffffff";
    let serverName = guildId ? GuildStore.getGuild(guildId)?.name || "Unknown Server" : "Direct Message";
    let channelName = channel?.name || "Unknown Channel";

    if (guildId && message.author?.id) {
        const member = GuildMemberStore.getMember(guildId, message.author.id);
        if (member && member.colorString) {
            roleColor = member.colorString;
        }
    } else if (message.member && message.member.colorString) {
        roleColor = message.member.colorString;
    } else if (message.colorString) {
        roleColor = message.colorString;
    }

    const authorObj = message.author || (message.member && message.member.user) || {};
    let authorName = "Unknown";
    
    if (message.member && message.member.nick) {
        authorName = message.member.nick;
    } else if (authorObj.global_name) {
        authorName = authorObj.global_name;
    } else if (authorObj.globalName) {
        authorName = authorObj.globalName;
    } else if (authorObj.username) {
        authorName = authorObj.username;
    }

    const currentUser = UserStore.getCurrentUser();
    const currentUserId = currentUser?.id;
    
    let isMentioned = false;
    const mentionsMap: Record<string, string> = {};

    if (message.mentions && Array.isArray(message.mentions)) {
        message.mentions.forEach((user: any) => {
            if (user.id === currentUserId) isMentioned = true;
            let name = user.global_name || user.username;
            if (guildId) {
                const member = GuildMemberStore.getMember(guildId, user.id);
                if (member && member.nick) name = member.nick;
            }
            mentionsMap[user.id] = name;
        });
    }

    const attachments = message.attachments?.map((att: any) => att.url) || [];

    let replyData = null;
    if (message.referenced_message) {
        replyData = {
            id: message.referenced_message.id,
            author: message.referenced_message.author?.username || "Unknown",
            text: message.referenced_message.content || ""
        };
    }

    const payload = {
        action: actionType, // MESSAGE_CREATE, MESSAGE_UPDATE, MESSAGE_DELETE
        id: message.id,
        channelId: message.channel_id,
        channelName: channelName,
        serverName: serverName,
        author: authorName,
        userId: authorObj.id, 
        color: roleColor,
        text: message.content || "",
        isMentioned: isMentioned,
        mentions: mentionsMap,
        attachments: attachments,
        replyTo: replyData
    };

    ws.send(JSON.stringify(payload));
}

function onMessageCreate(event: Record<string, any>) {
    processMessageAndSend(event, "MESSAGE_CREATE");
}

function onMessageUpdate(event: Record<string, any>) {
    processMessageAndSend(event, "MESSAGE_UPDATE");
}

function onMessageDelete(event: Record<string, any>) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        action: "MESSAGE_DELETE",
        id: event.id,
        channelId: event.channelId
    }));
}

function onTypingStart(event: Record<string, any>) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const user = UserStore.getUser(event.userId);
    if (!user) return;

    ws.send(JSON.stringify({
        action: "TYPING_START",
        channelId: event.channelId,
        userId: event.userId,
        author: user.global_name || user.username
    }));
}

export default definePlugin({
    name: "RobloxChatOverlay",
    description: "Локальный чат-оверлей в стиле Roblox. 📂 GitHub: github.com/kaip0v/RobloxDiscordChat | 💬 Telegram: @greenville",
    authors: [
        { 
            name: "rrt", 
            id: 507204871200571392n 
        }
    ],
    
    start() {
        connectWebSocket();
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageUpdate);
        FluxDispatcher.subscribe("MESSAGE_DELETE", onMessageDelete);
        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
    },
    
    stop() {
        if (ws) {
            ws.close();
            ws = null;
        }
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMessageUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", onMessageDelete);
        FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
    }
});