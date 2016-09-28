// from ZeroNet site development tutorial #1
// https://zeronet.readthedocs.io/en/latest/site_development/zeroframe_api_reference/
// http://127.0.0.1:43110/Blog.ZeroNetwork.bit/?Post:43:ZeroNet+site+development+tutorial+1
// http://127.0.0.1:43110/Blog.ZeroNetwork.bit/data/files/ZeroFrame.coffee

var ZeroFrame,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    slice = [].slice;

ZeroFrame = (function() {
    function ZeroFrame(url) {
        this.onCloseWebsocket = bind(this.onCloseWebsocket, this);
        this.onOpenWebsocket = bind(this.onOpenWebsocket, this);
        this.route = bind(this.route, this);
        this.onMessage = bind(this.onMessage, this);
        this.url = url;
        this.waiting_cb = {};
        this.wrapper_nonce = document.location.href.replace(/.*wrapper_nonce=([A-Za-z0-9]+).*/, "$1");
        this.connect();
        this.next_message_id = 1;
        this.init();
    }

    ZeroFrame.prototype.init = function() {
        return this;
    };

    ZeroFrame.prototype.connect = function() {
        this.target = window.parent;
        window.addEventListener("message", this.onMessage, false);
        return this.cmd("innerReady");
    };

    ZeroFrame.prototype.onMessage = function(e) {
        var cmd, message;
        message = e.data;
        cmd = message.cmd;
        if (cmd === "response") {
            if (this.waiting_cb[message.to] != null) {
                return this.waiting_cb[message.to](message.result);
            } else {
                return this.log("Websocket callback not found:", message);
            }
        } else if (cmd === "wrapperReady") {
            return this.cmd("innerReady");
        } else if (cmd === "ping") {
            return this.response(message.id, "pong");
        } else if (cmd === "wrapperOpenedWebsocket") {
            return this.onOpenWebsocket();
        } else if (cmd === "wrapperClosedWebsocket") {
            return this.onCloseWebsocket();
        } else {
            return this.route(cmd, message);
        }
    };

    ZeroFrame.prototype.route = function(cmd, message) {
        return this.log("ZeroFrame.prototype.route - ignored message ", JSON.stringify(message));
    };

    ZeroFrame.prototype.response = function(to, result) {
        return this.send({
            "cmd": "response",
            "to": to,
            "result": result
        });
    };

    ZeroFrame.prototype.cmd = function(cmd, params, cb) {
        if (params == null) {
            params = {};
        }
        if (cb == null) {
            cb = null;
        }
        return this.send({
            "cmd": cmd,
            "params": params
        }, cb);
    };

    ZeroFrame.prototype.send = function(message, cb) {
        if (cb == null) {
            cb = null;
        }
        message.wrapper_nonce = this.wrapper_nonce;
        message.id = this.next_message_id;
        this.next_message_id += 1;
        this.target.postMessage(message, "*");
        if (cb) {
            return this.waiting_cb[message.id] = cb;
        }
    };

    ZeroFrame.prototype.log = function() {
        var args;
        args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
        return console.log.apply(console, ["[ZeroFrame]"].concat(slice.call(args)));
    };

    ZeroFrame.prototype.onOpenWebsocket = function() {
        this.cmd("siteInfo", {}, (function(_this) {
            return function(site_info) {
                _this.site_info = site_info;
                _this.log('siteInfo = ' + JSON.stringify(site_info));
            };
        })(this));
        return this.log("Websocket open");
    };

    ZeroFrame.prototype.onCloseWebsocket = function() {
        return this.log("Websocket close");
    };

    return ZeroFrame;

})();

window.ZeroFrame = new ZeroFrame;