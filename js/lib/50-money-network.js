// Money-C1 - 1=could by one of many different Money network client implementations.

// fix missing Array.indexOf in IE8
// http://stackoverflow.com/questions/3629183/why-doesnt-indexof-work-on-an-array-ie8
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (elt /*, from*/) {
        var len = this.length >>> 0;

        var from = Number(arguments[1]) || 0;
        from = (from < 0)
            ? Math.ceil(from)
            : Math.floor(from);
        if (from < 0)
            from += len;

        for (; from < len; from++) {
            if (from in this &&
                this[from] === elt)
                return from;
        }
        return -1;
    };
}


// helper functions
var MoneyNetworkHelper = (function () {

    // local or session storage functions ==>

    // values in sessionStorage:
    // - data are discarded when user closes browser tab
    // - only userid and password keys
    // - never <userid> prefix before key
    // - values are not compressed or encrypted

    // values in localStorage:
    // - data are preserved when user closes tab or browser
    // - some values are global values without <userid> prefix. others are user specific values with <userid> prefix
    // - some values are encrypted (keys, authorization and other sensible information)
    // - encryption: key is as only item encrypted with password (human text). All other encrypted items are is encrypted with key (random string)
    // - some values are compressed (users and gifts arrays)
    // - rules (local_storage_rules) are derived from key name
    // - default values are <userid> prefix, no encryption and no compression (write warning in console.log)

    var storage_rules = {
        currency: {session: false, userid: true, compress: false, encrypt: false}, // currency code (ISO 4217)
        did: {session: false, userid: true, compress: false, encrypt: false}, // new unique device id
        friends: {session: false, userid: true, compress: true, encrypt: true}, // array with downloaded friends info from login
        gifts: {session: false, userid: true, compress: true, encrypt: true}, // "array" with gifts - encrypted - pseudo rule used for gift_1, gift_2 etc
        key: {session: false, userid: true, compress: true, encrypt: true}, // random password - used for localStorage encryption
        noti: {session: false, userid: true, compress: true, encrypt: true}, // "array" with notifications (message in UI) - only some type of notifications are saved in localStorage
        password: {session: true, userid: false, compress: false, encrypt: false}, // session password in clear text
        passwords: {session: false, userid: false, compress: false, encrypt: false}, // array with hashed passwords. size = number of accounts
        oauth: {session: false, userid: true, compress: true, encrypt: true}, // login provider oauth authorization
        prvkey: {session: false, userid: true, compress: true, encrypt: true}, // for encrypted user to user communication
        pubkey: {session: false, userid: true, compress: true, encrypt: false}, // for encrypted user to user communication
        secret: {session: false, userid: true, compress: true, encrypt: false}, // client secret - used as secret element in device.sha256 - 10 digits
        seq: {session: false, userid: true, compress: true, encrypt: false}, // sequence - for example used in verify_gifts request and response
        sid: {session: true, userid: false, compress: false, encrypt: false}, // unique session id - changes for every new device login
        userid: {session: true, userid: false, compress: false, encrypt: false}, // session userid (1, 2, etc) in clear text
        users: {session: false, userid: true, compress: true, encrypt: true} // array with users used in gifts and comments
    };

    // first character in stored value is an encryption/compression storage flag
    // storage flag makes it possible to select best compression method
    // and storage flag makes it possible to later change storage rules for already saved values
    var storage_flags = {
        a: {compress: 0, encrypt: 0, sequence: 0}, // clear text - not compressed, not encrypted
        b: {compress: 0, encrypt: 1, sequence: 0}, // encrypted only - not compressed
        c: {compress: 1, encrypt: 0, sequence: 0}, // LZString synchronous compression, not encrypted
        d: {compress: 1, encrypt: 1, sequence: 0}, // LZString synchronous compression, compress => encrypt
        e: {compress: 1, encrypt: 1, sequence: 1}, // LZString synchronous compression, encrypt => compress
        f: {compress: 2, encrypt: 0, sequence: 0}, // LZMA level 1 asynchronous compression, not encrypted
        g: {compress: 2, encrypt: 1, sequence: 0}, // LZMA level 1 asynchronous compression, compress => encrypt
        h: {compress: 2, encrypt: 1, sequence: 1}, // LZMA level 1 asynchronous compression, encrypt => compress
        i: {compress: 3, encrypt: 0, sequence: 0}, // compression 3, not encrypted (reserved / not implemented)
        j: {compress: 3, encrypt: 1, sequence: 0}, // compression 3, compress => encrypt (reserved / not implemented)
        k: {compress: 3, encrypt: 1, sequence: 1}, // compression 3, encrypt => compress (reserved / not implemented)
        l: {compress: 4, encrypt: 0, sequence: 0}, // compression 4, not encrypted (reserved / not implemented)
        m: {compress: 4, encrypt: 1, sequence: 0}, // compression 4, compress => encrypt (reserved / not implemented)
        n: {compress: 4, encrypt: 1, sequence: 1}  // compression 4, encrypt => compress (reserved / not implemented)
    };

    // reverse index - from compress*encrypt*sequence (binary 0-19) to storage flag a-n
    var storage_flag_index = {};

    function storage_options_bin_key(storage_options) {
        return 4 * storage_options.compress + 2 * storage_options.encrypt + storage_options.sequence;
    }

    (function () {
        var storage_flag; // a-n
        var index; // 0-19
        for (storage_flag in storage_flags) {
            if (storage_flags.hasOwnProperty(storage_flag)) {
                index = storage_options_bin_key(storage_flags[storage_flag]);
                storage_flag_index[index] = storage_flag;
            }
        }
    })();

    // todo: how to handle "no more space" in local storage?
    // 1) only keep newer gifts and relevant users in local storage
    //    gifts and users arrays should be saved in local storage in one operation to allow automatic space management
    //    add oldest_gift_at timestamp. Ignore gifts with timestamp before oldest_gift_id when sync. gifts with other devices
    //    or oldest_gift_id pointer. Ignore gifts with gift_id < oldest_gift_ud when sync. gifts when other devices
    // 2) a possibility is to store old blocks with gifts and users on server encrypted with pubkey
    //    that is show-more-rows functionality at end of page
    //    send a server request to get old data block. Return old data block and insert into users and gifts js arrays
    //    old data block stored on server can be changed if user info changes, friendship changes, or gifts are change or are deleted

    // symmetric encrypt sensitive data in local storage.
    // password is saved in session storage and is deleted when user closes tab in browser
    // also used for symmetric encryption in communication between clients
    function encrypt(text, password) {
        var output_wa;
        output_wa = CryptoJS.AES.encrypt(text, password, {format: CryptoJS.format.OpenSSL}); //, { mode: CryptoJS.mode.CTR, padding: CryptoJS.pad.AnsiX923, format: CryptoJS.format.OpenSSL });
        return output_wa.toString(CryptoJS.format.OpenSSL);
    }

    function decrypt(text, password) {
        var output_wa;
        output_wa = CryptoJS.AES.decrypt(text, password, {format: CryptoJS.format.OpenSSL}); // , { mode: CryptoJS.mode.CTR, padding: CryptoJS.pad.AnsiX923, format: CryptoJS.format.OpenSSL });
        return output_wa.toString(CryptoJS.enc.Utf8);
    }

    // LZString compress and decompress strings - fast and synchronous compress and decompress
    // https://github.com/pieroxy/lz-string
    // http://pieroxy.net/blog/pages/lz-string/guide.html)
    function compress1(text) {
        return LZString.compressToUTF16(text);
    }

    function decompress1(text) {
        return LZString.decompressFromUTF16(text);
    }

    // LZMA level 1 compress and decompress strings - not as fast as LZString - runs asynchronous
    // setItem uses LZString in compression. At end setItem submit a asynchronous task to check if LZMA level 1 compress is better
    // todo: LZMA disabled until I find a good method to convert byte array output from LZMA.compress into an utf-16 encoded string

    // lzma_compress0 - sequence = 0 - not encrypted or normal compress => encrypt sequence
    // lzma_compress1 - sequence = 1 - encrypted and reverse encrypt => compress sequence

    // params:
    // - key and value - original inputs to setItem
    // - session: true: sessionStorage, false: localStorage
    // - password: null: not encrypted, != null: encrypted
    // - length: length of lzstring compressed value (without storage flag)
    function lzma_compress1(key, value, session, password, length) {
        var pgm = 'lzma_compress1: ';
        value = encrypt(value, password);
        // start compress
        // var lzma = new LZMA;
        LZMA.compress(value, 1, function (value) {
            // compress result received
            console.log(pgm + 'compress result received. value = ' + value);
            if (value.length >= length) return;
            // lzma compress sequence 2 was better than lzstring compress and/or lzma compress sequence = 0 (compress => encrypt)
            console.log(pgm + 'key = ' + key + '. lzma compress sequence 2 was better than lzstring compress and/or lzma compress sequence = 0 (compress => encrypt)');
            // find storage flag and save new compressed value
            var storage_options = {compress: 2, encrypt: 1, sequence: 1};
            var bin_key = storage_options_bin_key(storage_options);
            var storage_flag = storage_flag_index[bin_key];
            if (!storage_flag) {
                console.log(pgm + 'Warning. key ' + key + ' was not optimized. Could not found storage flag for storage options = ' + JSON.stringify(storage_options));
                return;
            }
            value = storage_flag + value;
            // save
            if (session) sessionStorage.setItem(key, value);
            else localStorage.setItem(key, value);
        }, null);
    } // lzma_compress1
    function lzma_compress0(key, value, session, password, length) {
        var pgm = 'lzma_compress0: ';
        var save_value = value;
        // start compress
        // var lzma = new LZMA;
        LZMA.compress(value, 1, function (value) {
            // compress result received
            console.log(pgm + 'compress result received. value = ' + value);
            if (password) value = encrypt(value, password);
            if (value.length < length) {
                // lzma compress was better than lzstring compress
                console.log(pgm + 'key = ' + key + '. lzma compress was better than lzstring compress');
                // find storage flag and save new compressed value
                var storage_options = {compress: 2, encrypt: (password ? 1 : 0), sequence: 0};
                var bin_key = storage_options_bin_key(storage_options);
                var storage_flag = storage_flag_index[bin_key];
                if (!storage_flag) {
                    console.log(pgm + 'Warning. key ' + key + ' was not optimized. Could not found storage flag for storage options = ' + JSON.stringify(storage_options));
                    return;
                }
                value = storage_flag + value;
                // save
                if (session) sessionStorage.setItem(key, value);
                else localStorage.setItem(key, value);
                length = value.length - 1;
            }
            ;
            // start start_lzma_compress1 if encrypted - sequence = 1 - encrypt before compress
            if (password) lzma_compress1(key, save_value, session, password, length);
        }, null);
    } // check_lzma_compress

    // look storage rules for key. add default values and write warning to console log when using defaults
    function get_local_storage_rule(key) {
        var pgm = 'MoneyNetworkHelper.get_local_storage_rule: ';
        var key_options;
        if (storage_rules.hasOwnProperty(key)) key_options = storage_rules[key];
        else {
            console.log(pgm + 'Warning. ' + key + ' was not found in local_storage_rules hash.');
            key_options = {session: false, userid: true, compress: false, encrypt: false};
        }
        if (!key_options.hasOwnProperty('session')) {
            console.log(pgm + 'Warning. using default value session=false for key ' + key);
            key_options.session = false;
        }
        if (!key_options.hasOwnProperty('userid')) {
            key_options.userid = !key_options.session;
            console.log(pgm + 'Warning. using default value userid=' + key_options.userid + ' for key ' + key);
        }
        if (!key_options.hasOwnProperty('compress')) {
            console.log(pgm + 'Warning. using default value compress=false for key ' + key);
            key_options.compress = false;
        }
        if (!key_options.hasOwnProperty('encrypt')) {
            console.log(pgm + 'Warning. using default value encrpt=false for key ' + key);
            key_options.encrypt = false;
        }
        //if (!key_options.hasOwnProperty('key')) {
        //    console.log(pgm + 'Warning. using default value key=false for key ' + key) ;
        //    key_options.key = false ;
        //}
        return key_options;
    } // get_local_storage_rule


    // get/set item
    function getItem(key) {
        var pgm = 'MoneyNetworkHelper.getItem: ';
        // if (key == 'password') console.log(pgm + 'caller: ' + arguments.callee.caller.toString()) ;
        var pseudo_key = key; // .match(/^gift_[0-9]+$/) ? 'gifts' : key ; // use gifts rule for gift_1, gift_1 etc
        var rule = get_local_storage_rule(pseudo_key);
        if (rule.encrypt) var password_type = (key == 'key' ? 'password' : 'key'); // key is as only variable encrypted with human password
        // userid prefix?
        if (rule.userid) {
            var userid = getItem('userid');
            if ((typeof userid == 'undefined') || (userid == null) || (userid == '')) userid = 0;
            else userid = parseInt(userid);
            if (userid == 0) {
                // console.log(pgm + 'Error. key ' + key + ' is stored with userid prefix but userid was not found') ;
                return null;
            }
            key = userid + '_' + key;
        }
        // read stored value
        var value = rule.session ? sessionStorage.getItem(key) : localStorage.getItem(key);
        if ((typeof value == 'undefined') || (value == null) || (value == '')) return null; // key not found

        // get storage flag - how was data stored - first character in value
        var storage_flag = value.substr(0, 1);
        value = value.substr(1);
        var storage_options = storage_flags[storage_flag];
        if (!storage_options) {
            console.log(pgm + 'Error. Invalid storage flag ' + storage_flag + ' was found for key ' + key);
            return null;
        }

        // decompress
        if ((storage_options.compress > 0) && (storage_options.sequence == 1)) {
            // reverse encrypt => compress sequence was used when saving this data. decompress before decrypt
            // console.log(pgm + key + ' before decompress = ' + value) ;
            value = decompress1(value);
        }

        // decrypt
        if (storage_options.encrypt) {
            // console.log(pgm + key + ' before decrypt = ' + value) ;
            var password = getItem(password_type); // use key or password
            if ((typeof password == 'undefined') || (password == null) || (password == '')) {
                console.log(pgm + 'Error. key ' + key + ' is stored encrypted but ' + password_type + ' was not found');
                return null;
            }
            value = decrypt(value, password);
        }

        // decompress
        if ((storage_options.compress > 0) && (storage_options.sequence == 0)) {
            // normal compress => encrypt sequence was used when saving this data. decompress after decrypt
            // console.log(pgm + key + ' before decompress = ' + value) ;
            value = decompress1(value);
        }

        // ready
        // if (storage_options.encrypt || storage_options.compress) console.log(pgm + key + ' after decrypt and decompress = ' + value) ;
        // if (key.match(/oauth/)) console.log('getItem. key = ' + key + ', value = ' + value) ;
        return value;
    } // getItem

    function setItem(key, value) {
        var pgm = 'MoneyNetworkHelper.setItem: ';
        var save_value = value; // for optional lzma_compress0
        var pseudo_key = key.match(/^gift_[0-9]+$/) ? 'gifts' : key; // use gifts rule for gift_1, gift_1 etc
        var rule = get_local_storage_rule(pseudo_key);
        if (rule.encrypt) var password_type = (key == 'key' ? 'password' : 'key'); // key is as only variable encrypted with human password
        // userid prefix?
        if (rule.userid) {
            var userid = getItem('userid');
            if ((typeof userid == 'undefined') || (userid == null) || (userid == '')) userid = 0;
            else userid = parseInt(userid);
            if (userid == 0) {
                // console.log(pgm + 'Error. key ' + key + ' is stored with userid prefix but userid was not found') ;
                return;
            }
            key = userid + '_' + key;
        }
        // check password
        var password;
        if (rule.encrypt) {
            password = getItem(password_type); // use key or password
            if ((typeof password == 'undefined') || (password == null) || (password == '')) {
                console.log(pgm + 'Error. key ' + key + ' is stored encrypted but ' + password_type + ' was not found');
                return;
            }
        }
        var sequence;
        if (rule.compress && rule.encrypt) {
            // compress and encrypt. find best sequence
            // sequence 0 : normal sequence - compress before encrypt
            // sequence 1 : reverse sequence - encrypt before compress
            var value1 = encrypt(compress1(value), password);
            var value2 = compress1(encrypt(value, password));
            if (value1.length <= value2.length) {
                sequence = 0;
                value = value1;
            }
            else {
                sequence = 1;
                value = value2;
            }
        }
        else {
            sequence = 0;
            // compress?
            if (rule.compress) value = compress1(value);
            // encrypt?
            if (rule.encrypt) value = encrypt(value, password);
        }
        // set storage flag - how are data stored - first character in value
        var storage_options = {
            compress: (rule.compress ? 1 : 0),
            encrypt: (rule.encrypt ? 1 : 0),
            sequence: sequence
        };
        var bin_key = storage_options_bin_key(storage_options);
        var storage_flag = storage_flag_index[bin_key];
        if (!storage_flag) {
            console.log(pgm + 'Error. key ' + key + ' was not saved. Could not found storage flag for storage options = ' + JSON.stringify(storage_options));
            return;
        }
        value = storage_flag + value;
        // save
        // if (key.match(/oauth/)) console.log('setItem. key = ' + key + ', value = ' + value) ;
        if (rule.session) sessionStorage.setItem(key, value);
        else localStorage.setItem(key, value);
        // optimize compression for saved value

        // todo: disabled until I find a method to convert byte array returned from LZMA.compress into an valid utf-16 string
        // check if lzma compress if better than lzstring compress
        // if (rule.compress) lzma_compress0(key, save_value, rule.session, password, value.length-1) ;
    } // setItem

    function removeItem(key) {
        var pgm = 'MoneyNetworkHelper.setItem: ';
        var pseudo_key = key.match(/^gift_[0-9]+$/) ? 'gifts' : key; // use gifts rule for gift_1, gift_1 etc
        var rule = get_local_storage_rule(pseudo_key);
        // sessionStorage or localStorage?
        var storage = rule.session ? sessionStorage : localStorage;
        // userid prefix?
        if (rule.userid) {
            var userid = getItem('userid');
            if ((typeof userid == 'undefined') || (userid == null) || (userid == '')) userid = 0;
            else userid = parseInt(userid);
            if (userid == 0) {
                console.log(pgm + 'Error. key ' + key + ' is stored with userid prefix but userid was not found');
                return null;
            }
            key = userid + '_' + key;
        }
        // remove
        if (rule.session) sessionStorage.removeItem(key);
        else localStorage.removeItem(key);
    } // removeItem

    function getUserId() {
        var userid = MoneyNetworkHelper.getItem('userid');
        if (typeof userid == 'undefined') userid = 0;
        else if (userid == null) userid = 0;
        else if (userid == '') userid = 0;
        else userid = parseInt(userid);
        return userid;
    } // getUserId

    // sha256 digest - used for one way password encryption and signatures for gifts and comments
    // arguments: list of input fields to sha256 calculation
    // todo: ignore empty fields at end of input? will allow adding new empty fields to gifts and comments signature without destroying old signatures
    function sha256() {
        var pgm = 'MoneyNetworkHelper.sha256: ';
        var texts = [];
        for (var i = 0; i < arguments.length; i++) {
            switch (typeof arguments[i]) {
                case 'string' :
                    texts.push(arguments[i]);
                    break;
                case 'boolean':
                    texts.push(arguments[i].toString());
                    break;
                case 'number':
                    texts.push(arguments[i].toString());
                    break;
                case 'undefined':
                    texts.push('');
                    break;
                default:
                    // null or an object
                    if (arguments[i] == null) texts.push('');
                    else texts.push(JSON.stringify(arguments[i]));
            } // switch
        }
        ;
        // strip empty fields from end of sha256 input
        while ((texts.length > 0) && (texts[texts.length - 1] == '')) texts.length = texts.length - 1;
        var text = texts.length == 0 ? '' : texts.join(',');
        var sha256 = CryptoJS.SHA256(text).toString(CryptoJS.enc.Latin1);
        // console.log(pgm + 'text = ' + text + ', sha256 = ' + sha256)
        return sha256;
    } // sha256

    // generate password - used as key for local storage encryption and used in client to client communication (symmetric encryption)
    function generate_random_password(length) {
        var character_set = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789![]{}#%&/()=?+-:;_-.@$|£';
        var password = [], index, char;
        for (var i = 0; i < length; i++) {
            index = Math.floor(Math.random() * character_set.length);
            char = character_set.substr(index, 1);
            password.push(char);
        }
        ;
        return password.join('');
    } // generate_random_password

    // client login (password from device_login_form form)
    // 0 = invalid password, > 0 : userid
    // use create_new_account = true to force create a new user account
    // support for more than one user account
    function client_login(password, create_new_account) {
        var password_sha256, passwords_s, passwords_a, i, userid, did, crypt, pubkey, prvkey, prvkey_aes, giftid_key;
        password_sha256 = sha256(password);
        // passwords: array with hashed passwords. size = number of accounts
        passwords_s = getItem('passwords');
        if ((passwords_s == null) || (passwords_s == '')) passwords_a = [];
        else passwords_a = JSON.parse(passwords_s);
        // check old accounts
        for (i = 0; i < passwords_a.length; i++) {
            if (password_sha256 == passwords_a[i]) {
                // log in ok - account existsgetItem
                userid = i + 1;
                // save login
                setItem('userid', userid);
                setItem('password', password);
                return userid;
            }
        }
        // password was not found
        if ((passwords_a.length == 0) || create_new_account) {
            // create new account
            userid = passwords_a.length + 1; // sequence = number of user accounts in local storage
            // setup new account
            passwords_a.push(password_sha256);
            passwords_s = JSON.stringify(passwords_a);
            // generate key pair for client to client RSA encryption
            crypt = new JSEncrypt({default_key_size: 2048});
            crypt.getKey();
            pubkey = crypt.getPublicKey();
            prvkey = crypt.getPrivateKey();
            // key for symmetric encryption in localStorage - 80-120 characters (avoid using human text in encryption)
            var key_lng = Math.round(Math.random() * 40) + 80;
            var key = MoneyNetworkHelper.generate_random_password(key_lng);
            // save login in sessionStorage
            // note that password is saved in clear text in sessionStorage
            // please use device log out or close browser tab when finished
            setItem('userid', userid);
            setItem('password', password);
            // save new user account
            setItem('key', key);
            setItem('prvkey', prvkey); // private key - only used on this device - never sent to server or other clients
            setItem('pubkey', pubkey); // public key - sent to server and other clients
            setItem('passwords', passwords_s); // array with sha256 hashed passwords. length = number of accounts
            return userid;
        }
        // invalid password (create_new_account=false)
        return 0;
    } // client_login


    // client logout
    function client_logout() {
        removeItem('password');
        removeItem('userid');
    } // client_logout


    // temporary buffer flash messages (used doing routeProvider redirects)
    var flash_type = null;
    var flash_message = null;

    function setFlashMessage(type, message) {
        flash_type = type;
        flash_message = message;
    }

    function getFlashMessage() {
        return flash_message;
    }

    function getFlashType() {
        return flash_type;
    }

    function clearFlashMessage() {
        flash_type = null;
        flash_message = null;
    }


    // export helpers
    console.log('MoneyNetworkHelper object initialised');
    return {
        // local storage helpers
        getItem: getItem,
        setItem: setItem,
        removeItem: removeItem,
        getUserId: getUserId,
        client_login: client_login,
        client_logout: client_logout,
        generate_random_password: generate_random_password,
        setFlashMessage: setFlashMessage,
        getFlashType: getFlashType,
        getFlashMessage: getFlashMessage,
        clearFlashMessage: clearFlashMessage
    };
})();
// MoneyNetworkHelper end


// angularJS app
angular.module('MoneyNetwork', ['ngRoute', 'ngSanitize'])

    .config(['$routeProvider', function ($routeProvider) {
        // resolve: check if user is logged. check is used in multiple routes
        var check_auth_resolve = ['$location', function ($location) {
            if (!MoneyNetworkHelper.getUserId()) {
                // not logged in
                MoneyNetworkHelper.setFlashMessage('info', 'Not allowed. Please log in');
                $location.path('/auth');
                $location.replace();
            }
        }];

        // setup routes. see ng-template in index.html page
        $routeProvider
            .when('/auth', {
                templateUrl: 'auth.html',
                controller: 'AuthCtrl as a',
            })
            .when('/about', {
                templateUrl: 'about.html'
            })
            .when('/contacts', {
                templateUrl: 'contacts.html',
                resolve: {check_auth: check_auth_resolve}
            })
            .when('/home', {
                templateUrl: 'home.html',
                resolve: {check_auth: check_auth_resolve}
            })
            .when('/logout', {
                resolve: {
                    logout: ['$location', function ($location) {
                        if (MoneyNetworkHelper.getUserId()) MoneyNetworkHelper.setFlashMessage('success', 'Log out OK') ;
                        else MoneyNetworkHelper.setFlashMessage('info', 'Already logged out') ;
                        MoneyNetworkHelper.client_logout();
                        $location.path('/auth');
                        $location.replace();
                    }]
                }
            })
            .when('/user', {
                templateUrl: 'user.html',
                controller: 'UserCtrl as u',
                resolve: {check_auth: check_auth_resolve}
            })
            .otherwise({
                redirectTo: function (routeParams, path, search) {
                    return '/auth';
                }
            });
        // end config (ng-routes)
    }])

    // trying to make a angularJS service from ZeroFrame API
    .factory('ZeroFrameService', [function () {

        var self = this;
        var service = 'ZeroFrameService';
        console.log(service + ' loaded');

        // copy/paste from ZeroChat example. Original example in coffee script
        var bind = function (fn, me) {
                return function () {
                    return fn.apply(me, arguments);
                };
            },
            extend = function (child, parent) {
                for (var key in parent) {
                    if (hasProp.call(parent, key)) child[key] = parent[key];
                }
                function ctor() {
                    this.constructor = child;
                }

                ctor.prototype = parent.prototype;
                child.prototype = new ctor();
                child.__super__ = parent.prototype;
                return child;
            },
            hasProp = {}.hasOwnProperty;
        var superClass = ZeroFrame;

        extend(ZeroFrameService, superClass);

        function ZeroFrameService() {
            this.onOpenWebsocket = bind(this.onOpenWebsocket, this);
            ZeroFrameService.__super__.constructor.apply(this, arguments);
        }

        ZeroFrameService.prototype.init = function () {
            this.addLine("inited! (2)");
        };

        ZeroFrameService.prototype.addLine = function (line) {
            console.log(line);
        };

        ZeroFrameService.prototype.onOpenWebsocket = function (e) {
            this.cmd("serverInfo", {}, (function (_this) {
                return function (server_info) {
                    return _this.addLine("serverInfo response (2): <pre>" + JSON.stringify(server_info, null, 2) + "</pre>");
                };
            })(this));
            this.cmd("siteInfo", {}, (function (_this) {
                return function (site_info) {
                    return _this.addLine("siteInfo response (2): <pre>" + JSON.stringify(site_info, null, 2) + "</pre>");
                };
            })(this));
        };

        ZeroFrameService.prototype.serverInfo = function (e) {
            this.cmd("serverInfo", {}, (function (_this) {
                return function (server_info) {
                    return _this.addLine("serverInfo response (3): <pre>" + JSON.stringify(server_info, null, 2) + "</pre>");
                };
            })(this));
            return 'serverInfo request send to server' ;
        };

        return new ZeroFrameService();
    }])

    .controller('NavCtrl', ['ZeroFrameService', function (zeroFrameService) {
        var self = this;
        var controller = 'NavCtrl';
        console.log(controller + ' loaded');
        self.texts = {appname: 'Money Network'};

        // test ZeroFrameService
        var server_info ;
        server_info = zeroFrameService.serverInfo() ;
        console.log(controller + ': server_info = ' + server_info) ;

    }])

    .controller('AuthCtrl', [function () {
        var self = this;
        var controller = 'AuthCtrl';
        console.log(controller + ' loaded');
    }])

;

// angularJS app end
