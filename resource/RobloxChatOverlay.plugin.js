/**
 * @name RobloxChatOverlay
 * @author rrt
 * @description Local chat for Roblox. Creator: telegram @greenville
 * @version 1.0.0
 * @authorId 507204871200571392
 * @source https://github.com/kaip0v/RobloxDiscordChat
 */

module.exports = class RobloxChatOverlay {
    constructor() {
        this.ws = null;
        this.lastSentId = null;
        this.onMessageCreate = this.onMessageCreate.bind(this);
        this.onMessageUpdate = this.onMessageUpdate.bind(this);
        this.onMessageDelete = this.onMessageDelete.bind(this);
        this.onTypingStart = this.onTypingStart.bind(this);
    }

    start() {
        this.Dispatcher = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("dispatch", "subscribe"));
        this.MessageActions = BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps("sendMessage", "editMessage"));
        this.ChannelStore = BdApi.Webpack.getStore("ChannelStore");
        this.GuildStore = BdApi.Webpack.getStore("GuildStore");
        this.UserStore = BdApi.Webpack.getStore("UserStore");
        this.GuildMemberStore = BdApi.Webpack.getStore("GuildMemberStore");

        this.connectWebSocket();

        if (this.Dispatcher) {
            this.Dispatcher.subscribe("MESSAGE_CREATE", this.onMessageCreate);
            this.Dispatcher.subscribe("MESSAGE_UPDATE", this.onMessageUpdate);
            this.Dispatcher.subscribe("MESSAGE_DELETE", this.onMessageDelete);
            this.Dispatcher.subscribe("TYPING_START", this.onTypingStart);
        }
    }

    stop() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.Dispatcher) {
            this.Dispatcher.unsubscribe("MESSAGE_CREATE", this.onMessageCreate);
            this.Dispatcher.unsubscribe("MESSAGE_UPDATE", this.onMessageUpdate);
            this.Dispatcher.unsubscribe("MESSAGE_DELETE", this.onMessageDelete);
            this.Dispatcher.unsubscribe("TYPING_START", this.onTypingStart);
        }
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

        this.ws = new WebSocket("ws://127.0.0.1:37485");
        this.ws.onopen = () => {};
        this.ws.onerror = () => {};
        this.ws.onclose = () => setTimeout(() => this.connectWebSocket(), 5000);

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.action === "SEND_MESSAGE" && data.channelId && data.text && this.MessageActions) {
                    this.MessageActions.sendMessage(
                        data.channelId,
                        { content: data.text, invalidEmojis: [], validNonShortcutEmojis: [], tts: false },
                        undefined,
                        {}
                    );
                }
            } catch (err) {}
        };
    }

    processMessageAndSend(event, actionType) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const message = event.message || event;
        if (!message || !message.id) return;
        if (message.state === "SENDING" && actionType === "MESSAGE_CREATE") return;

        if (actionType === "MESSAGE_CREATE") {
            if (message.id === this.lastSentId) return;
            this.lastSentId = message.id;
        }

        const channel = this.ChannelStore ? this.ChannelStore.getChannel(message.channel_id) : null;
        const guildId = channel ? channel.guild_id : null;
        let roleColor = "#ffffff";
        let serverName = "Direct Message";
        
        if (guildId && this.GuildStore) {
            const guild = this.GuildStore.getGuild(guildId);
            if (guild) serverName = guild.name;
        }
        let channelName = channel ? channel.name : "Unknown Channel";

        if (guildId && message.author?.id && this.GuildMemberStore) {
            const member = this.GuildMemberStore.getMember(guildId, message.author.id);
            if (member && member.colorString) roleColor = member.colorString;
        } else if (message.member && message.member.colorString) {
            roleColor = message.member.colorString;
        } else if (message.colorString) {
            roleColor = message.colorString;
        }

        const authorObj = message.author || (message.member && message.member.user) || {};
        let authorName = message.member?.nick || authorObj.global_name || authorObj.globalName || authorObj.username || "Unknown";

        const currentUser = this.UserStore ? this.UserStore.getCurrentUser() : null;
        const currentUserId = currentUser ? currentUser.id : null;

        let isMentioned = false;
        const mentionsMap = {};

        if (message.mentions && Array.isArray(message.mentions)) {
            message.mentions.forEach((user) => {
                if (user.id === currentUserId) isMentioned = true;
                let name = user.global_name || user.username;
                if (guildId && this.GuildMemberStore) {
                    const member = this.GuildMemberStore.getMember(guildId, user.id);
                    if (member && member.nick) name = member.nick;
                }
                mentionsMap[user.id] = name;
            });
        }

        const attachments = message.attachments ? message.attachments.map(att => att.url) : [];
        let replyData = null;
        if (message.referenced_message) {
            replyData = {
                id: message.referenced_message.id,
                author: message.referenced_message.author?.username || "Unknown",
                text: message.referenced_message.content || ""
            };
        }

        this.ws.send(JSON.stringify({
            action: actionType,
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
        }));
    }

    onMessageCreate(event) { this.processMessageAndSend(event, "MESSAGE_CREATE"); }
    onMessageUpdate(event) { this.processMessageAndSend(event, "MESSAGE_UPDATE"); }

    onMessageDelete(event) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ action: "MESSAGE_DELETE", id: event.id, channelId: event.channelId }));
    }

    onTypingStart(event) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const user = this.UserStore ? this.UserStore.getUser(event.userId) : null;
        if (!user) return;
        this.ws.send(JSON.stringify({
            action: "TYPING_START",
            channelId: event.channelId,
            userId: event.userId,
            author: user.global_name || user.username
        }));
    }
};
