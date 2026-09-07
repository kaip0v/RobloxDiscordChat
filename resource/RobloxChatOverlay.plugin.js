/**
 * @name RobloxChatOverlay
 * @author rrt
 * @description Локальный чат для Roblox с поддержкой перехода в ЛС и резервной отправкой. Creator: telegram @greenville
 * @version 1.0.1
 * @authorId 507204871200571392
 * @source https://github.com/kaip0v/RobloxDiscordChat
 */

module.exports = class RobloxChatOverlay {
    start() {
        this.ws = null;
        this.lastSentId = null;
        
        this.boundOnMessageCreate = (e) => this.onMessageCreate(e);
        this.boundOnMessageUpdate = (e) => this.onMessageUpdate(e);
        this.boundOnMessageDelete = (e) => this.onMessageDelete(e);
        this.boundOnTypingStart = (e) => this.onTypingStart(e);

        const getModule = (...props) => {
            if (BdApi.Webpack && BdApi.Webpack.getModule) {
                if (BdApi.Webpack.Filters && typeof BdApi.Webpack.Filters.byKeys === "function") {
                    return BdApi.Webpack.getModule(BdApi.Webpack.Filters.byKeys(...props));
                }
                if (BdApi.Webpack.Filters && typeof BdApi.Webpack.Filters.byProps === "function") {
                    return BdApi.Webpack.getModule(BdApi.Webpack.Filters.byProps(...props));
                }
                return BdApi.Webpack.getModule(m => m && props.every(p => m[p] !== undefined));
            }
            return BdApi.findModuleByProps(...props);
        };

        this.MessageActions = getModule("sendMessage", "editMessage");
        this.ChannelStore = getModule("getChannel", "hasChannel");
        this.GuildStore = getModule("getGuild", "getGuildCount");
        this.UserStore = getModule("getUser", "getCurrentUser");
        this.GuildMemberStore = getModule("getMember", "getMembers");
        
        this.PrivateChannelActions = getModule("openPrivateChannel");
        this.NavigationUtils = getModule("transitionTo");
        this.HTTP = getModule("get", "post", "put", "patch");

        this.connectWebSocket();

        // Надежный метод извлечения из кэша (без лишнего мусора)
        if (this.ChannelStore && this.ChannelStore._dispatcher) {
            this.Dispatcher = this.ChannelStore._dispatcher;
            this.Dispatcher.subscribe("MESSAGE_CREATE", this.boundOnMessageCreate);
            this.Dispatcher.subscribe("MESSAGE_UPDATE", this.boundOnMessageUpdate);
            this.Dispatcher.subscribe("MESSAGE_DELETE", this.boundOnMessageDelete);
            this.Dispatcher.subscribe("TYPING_START", this.boundOnTypingStart);
            console.log("[RobloxChatOverlay] ПЛАГИН ЗАПУЩЕН! Успешное подключение к системному диспетчеру.");
        }
    }

    stop() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.Dispatcher) {
            this.Dispatcher.unsubscribe("MESSAGE_CREATE", this.boundOnMessageCreate);
            this.Dispatcher.unsubscribe("MESSAGE_UPDATE", this.boundOnMessageUpdate);
            this.Dispatcher.unsubscribe("MESSAGE_DELETE", this.boundOnMessageDelete);
            this.Dispatcher.unsubscribe("TYPING_START", this.boundOnTypingStart);
        }
    }

    connectWebSocket() {
        if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

        this.ws = new WebSocket("ws://127.0.0.1:37485");
        this.ws.onerror = () => {};
        this.ws.onclose = () => setTimeout(() => this.connectWebSocket(), 5000);

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.action === "SEND_MESSAGE" && data.channelId && data.text) {
                    try {
                        if (this.MessageActions) {
                            this.MessageActions.sendMessage(
                                data.channelId,
                                { content: data.text, invalidEmojis: [], validNonShortcutEmojis: [], tts: false },
                                undefined,
                                {}
                            );
                        }
                    } catch (err) {
                        if (this.HTTP) {
                            this.HTTP.post({
                                url: `/channels/${data.channelId}/messages`,
                                body: { content: data.text }
                            }).catch(() => {});
                        }
                    }
                }

                if (data.action === "OPEN_DM" && data.userId && this.PrivateChannelActions && this.NavigationUtils) {
                    Promise.resolve(this.PrivateChannelActions.openPrivateChannel(data.userId))
                        .then(channelId => {
                            if (channelId) this.NavigationUtils.transitionTo(`/channels/@me/${channelId}`);
                        }).catch(() => {});
                }
            } catch (err) {}
        };
    }

    processMessageAndSend(event, actionType) {
        try {
            const message = event.message || event;
            if (!message || !message.id) return;
            if (message.state === "SENDING" && actionType === "MESSAGE_CREATE") return;
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

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

            const authorObj = message.author || (message.member && message.member.user) || {};
            let authorName = message.member?.nick || authorObj.global_name || authorObj.globalName || authorObj.username || "Unknown";

            if (guildId && authorObj.id && this.GuildMemberStore) {
                const member = this.GuildMemberStore.getMember(guildId, authorObj.id);
                if (member && member.colorString) roleColor = member.colorString;
            } else if (message.colorString) {
                roleColor = message.colorString;
            }

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

        } catch (err) {}
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
