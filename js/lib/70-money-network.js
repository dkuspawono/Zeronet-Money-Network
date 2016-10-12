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

    var module = 'MoneyNetworkHelper' ;

    // local or session storage functions ==>

    // sessionStorage and localStorage implementation. direct calls are not working in ZeroNet. Error: The operation is insecure
    // sessionStorage is implemented as a JS object
    // localStorage is implemented as a JS object stored and updates sync asynchronously in ZeroFrame API

    // sessionStorage.
    var session_storage = {} ;

    // localStorage javascript copy is loaded from ZeroFrame API. Initialized asyn. Takes a moment before JS local_storage copy is ready
    var local_storage = { loading: true } ;
    var local_storage_functions = [] ; // functions waiting for localStorage to be ready. see authCtrl.set_register_yn
    function local_storage_bind(f) {
        if (local_storage.loading) local_storage_functions.push(f);
        else f() ;
    }
    ZeroFrame.cmd("wrapperGetLocalStorage", [], function (res) {
        var pgm = module + '.wrapperGetLocalStorage callback (1): ';
        // console.log(pgm + 'typeof res =' + typeof res) ;
        // console.log(pgm + 'res = ' + JSON.stringify(res)) ;
        if (!res) res = [{}] ;
        res = res[0];
        // moving values received from ZeroFrame API to JS copy of local storage
        // console.log(pgm + 'old local_storage = ' + JSON.stringify(local_storage)) ;
        // console.log(pgm + 'moving values received from ZeroFrame API to JS local_storage copy');
        var key ;
        for (key in local_storage) if (!res.hasOwnProperty(key)) delete local_storage[key] ;
        for (key in res) local_storage[key] = res[key] ;
        // console.log(pgm + 'local_storage = ' + JSON.stringify(local_storage));
        // execute any function waiting for localStorage to be ready
        for (var i=0 ; i<local_storage_functions.length ; i++) {
            var f = local_storage_functions[i] ;
            f();
        }
        local_storage_functions.length = 0 ;
    }) ;

    // write JS copy of local storage back to ZeroFrame API
    function local_storage_save() {
        var pgm = module + '.local_storage_save: ' ;
        // console.log(pgm + 'calling wrapperSetLocalStorage');
        ZeroFrame.cmd("wrapperSetLocalStorage", [local_storage], function () {
            var pgm = module + '.local_storage_save wrapperSetLocalStorage callback: ';
            // console.log(pgm + 'OK');
        }) ;
    } // local_storage_save


    // search ZeroNet for new potential contracts with matching search words
    // add/remove new potential contracts to/from local_storage_contracts array (MoneyNetworkService and ContactCtrl)
    // fnc_when_ready - callback - execute when local_storage_contracts are updated
    function zeronet_contact_search (local_storage_contracts, fnc_when_ready) {
        var pgm = module + '.zeronet_contact_search: ' ;
        // find json_id and user_seq for current user.
        // must use search words for current user
        // must not return search hits for current user
        var directory = 'users/' + ZeroFrame.site_info.auth_address ;
        var pubkey = getItem('pubkey') ;
        var query = "select json.json_id, users.user_seq from json, users " +
            "where json.directory = '" + directory + "' " +
            "and users.json_id = json.json_id " +
            "and users.pubkey = '" + pubkey + "'";
        // console.log(pgm + 'query 1 = ' + query) ;
        ZeroFrame.cmd("dbQuery", [query], function(res) {
            var pgm = module + '.zeronet_contact_search dbQuery callback 1: ' ;
            // console.log(pgm + 'res = ' + JSON.stringify(res)) ;
            if (res.error) {
                ZeroFrame.cmd("wrapperNotification", ["error", "Search for new contacts failed: " + res.error, 5000]);
                console.log(pgm + "Search for new contacts failed: " + res.error) ;
                console.log(pgm + 'query = ' + query) ;
                return ;
            }
            if (res.length == 0) {
                // current user not in data.users array. must be an user without any search words in user_info
                ZeroFrame.cmd("wrapperNotification", ["info", "No search words in user profile. Please add some search words and try again", 3000]);
                console.log(pgm + 'query = ' + query) ;
                return ;
            }
            var json_id = res[0].json_id ;
            var user_seq = res[0].user_seq ;
            // console.log(pgm + 'json_id = ' + json_id + ', user_seq = ' + user_seq) ;
            // find other clients with matching search words using sqlite like operator
            // a) search words stored in ZeroNet. public search words. Shared on ZeroNet
            // todo: minor problem with a) There goes a few seconds between updating data.json and before updated search words are available for dbQuery. maybe only use b) with Search and Hidden tags
            var my_search =
                "select search.tag, search.value from search " +
                "where search.json_id = " + json_id + " and search.user_seq = " + user_seq ;
            // b) search words stored in localStorage. private search words. Not shared in ZeroNet
            var user_info = getItem('user_info') ;
            if (user_info) user_info = JSON.parse(user_info) ;
            else user_info = [] ;
            var i, row ;
            for (i=0 ; i<user_info.length ; i++) {
                row = user_info[i] ;
                if (row.privacy != 'Hidden') continue ;
                row.tag = row.tag.replace(/'/g, "''") ; // escape ' in strings
                row.value = row.value.replace(/'/g, "''") ; // escape ' in strings
                my_search = my_search + " union all select '" + row.tag + "' as tag, '" + row.value + "' as value"
            }
            // console.log(pgm + 'my_search = ' + my_search) ;

            //// old query without cert_user_id
            //query =
            //    "select" +
            //    "  my_search.tag as my_tag, my_search.value as my_value," +
            //    "  users.pubkey as other_pubkey, substr(json.directory,7) other_auth_address," +
            //    "  search.tag as other_tag, search.value as other_value " +
            //    "from (" + my_search + ") as my_search, search, users, json " +
            //    "where (my_search.tag like search.tag and  my_search.value like search.value " +
            //    "or search.tag like my_search.tag and search.value like my_search.value) " +
            //    "and not (search.json_id = " + json_id + " and search.user_seq = " + user_seq + ") " +
            //    "and users.json_id = search.json_id " +
            //    "and users.user_seq = search.user_seq " +
            //    "and json.json_id = search.json_id";
            // new query with cert_user_id
            query =
                "select" +
                "  my_search.tag as my_tag, my_search.value as my_value," +
                "  users.pubkey as other_pubkey, substr(data_json.directory,7) as other_auth_address," +
                "  keyvalue1.value as other_cert_user_id, keyvalue2.value as other_user_modified," +
                "  search.tag as other_tag, search.value as other_value " +
                "from (" + my_search + ") as my_search, " +
                "     search, users, json as data_json, json as user_json, keyvalue as keyvalue1, keyvalue as keyvalue2 " +
                "where (my_search.tag like search.tag and  my_search.value like search.value " +
                "or search.tag like my_search.tag and search.value like my_search.value) " +
                "and not (search.json_id = " + json_id + " and search.user_seq = " + user_seq + ") " +
                "and users.json_id = search.json_id " +
                "and users.user_seq = search.user_seq " +
                "and data_json.json_id = search.json_id " +
                "and user_json.directory = data_json.directory " +
                "and user_json.file_name = 'content.json' " +
                "and keyvalue1.json_id = user_json.json_id " +
                "and keyvalue1.key = 'cert_user_id' " +
                "and keyvalue2.json_id = user_json.json_id " +
                "and keyvalue2.key = 'modified'" ;
            // console.log(pgm + 'query 2 = ' + query) ;
            ZeroFrame.cmd("dbQuery", [query], function(res) {
                var pgm = module + '.zeronet_contact_search dbQuery callback 2: ';
                // console.log(pgm + 'res = ' + JSON.stringify(res));
                if (res.error) {
                    ZeroFrame.cmd("wrapperNotification", ["error", "Search for new contacts failed: " + res.error, 5000]);
                    console.log(pgm + "Search for new contacts failed: " + res.error) ;
                    console.log(pgm + 'query = ' + query) ;
                    return;
                }
                if (res.length == 0) {
                    // current user not in data.users array. must be an user without any search words in user_info
                    ZeroFrame.cmd("wrapperNotification", ["info", "No new contacts were found. Please add/edit search/hidden words and try again", 3000]);
                    return;
                }
                var unique_id, unique_ids = [], res_hash = {}, ignore, j ;
                for (var i=0 ; i<res.length ; i++) {
                    // check contacts on ignore list
                    ignore=false ;
                    for (j=0 ; (!ignore && (j<local_storage_contracts.length)) ; j++) {
                        if (local_storage_contracts[j].type != 'ignore') continue ;
                        if (res[i].auth_address == local_storage_contracts[j].auth_address) ignore=true ;
                        if (res[i].pubkey == local_storage_contracts[j].pubkey) ignore=true ;
                    }
                    if (ignore) continue ;
                    // add search match to res_hash
                    // unique id is sha256 signatur of ZeroNet authorization and localStorage authorization
                    // note many to many relation in the authorization and contact ids:
                    // - a ZeroNet id can have been used on multiple devices (localStorage) when communicating with ZeroNet
                    // - public/private localStorage key pairs can have been exported to other devices
                    unique_id = CryptoJS.SHA256(res[i].other_auth_address + '/'  + res[i].other_pubkey).toString();
                    res[i].other_unique_id = unique_id;
                    if (unique_ids.indexOf(res[i].other_unique_id)==-1) unique_ids.push(res[i].other_unique_id) ;
                    if (!res_hash.hasOwnProperty(unique_id)) res_hash[unique_id] = {
                        type: 'new',
                        auth_address: res[i].other_auth_address,
                        cert_user_id: res[i].other_cert_user_id,
                        pubkey: res[i].other_pubkey,
                        search: [{ tag: 'Last updated', value: res[i].other_user_modified, privacy: 'Search', row: 1}]
                    };
                    res_hash[unique_id].search.push({
                        tag: res[i].other_tag,
                        value: res[i].other_value,
                        privacy: 'Search',
                        row: res_hash[unique_id].search.length+1
                    }) ;
                }
                if (unique_ids.length == 1) ZeroFrame.cmd("wrapperNotification", ["info", "1 new contact", 3000]);
                else ZeroFrame.cmd("wrapperNotification", ["info", unique_ids.length + " new contacts", 3000]);
                // console.log(pgm + 'res = ' + JSON.stringify(res)) ;
                // console.log(pgm + 'res_hash = ' + JSON.stringify(res_hash)) ;
                //res_hash = {
                //    "4fef4f9678487b98baf77c6808f9a67651968534133b570677c9490406c4b5cc": {
                //        "type": "new",
                //        "auth_address": "1PcU45foygsjzGmGhWSpsa7KMRnZJ4J3tr",
                //        "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB4k3F/Trrl31HKwlzhCqui\nEcPlRt1FaIGoeemPJ5rlhGedJfHS3DGkUOZOqgm0lGQHqAeRhktvnZcFAcrQDKkz\nWBA4m1oFBumBM3M/x/aqDDsHNFqZD4fPhz9DpEbpgHMODCZLNLh7Z88I7FOnGtih\nR3Q/h4DSa0NzGdHiYYdN69uLzZQydjByJcM18oaYIdw1xdYEgGBOFKa6gk2si3Je\nHraO9diGqsofLNFyAenVkwvFQzQbFZaJuTllSlDHpCNUFVBnIBWpGak5gxEzS7eH\npW9FXpu96pxV/ACS6EOad05SEr4V02lY5yFs87Edy+Qv6DASg49GP9J6pLOlLeaZ\nAgMBAAE=\n-----END PUBLIC KEY-----",
                //        "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "%x%"}]
                //    },
                //    "12eabf2eeac1e7d21ee219a0e3b6269a1c074062877c8c9afb4d9ef4be4aa973": {
                //        "type": "new",
                //        "auth_address": "15xxXSPEf1JN4a5Kna5itWbDVEZfaYTUdD",
                //        "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvXklRnKF3OQgF3htGDnW\nvx4+t9dvJu2gFktNi/C5PI63ej3+fH8zpa2O3o5Vuwh3ma/WyAQe7NPkl2qL3jow\nHh6d/S5o6vJ6BLBRK2/9SGvsAoKmWeRhsjmGZoIrOH5QRGY82giuEbCmtQVWQZZc\nwoBQSxAJJOULF65ebnoylXmGgFNLwj0vwCZIxx/W8W4n8pOOVcmfbRuX3H1eRmgt\nyWp0rF4bByfEjHcMhwidht60cUMSmO6yDyAgrka1LLb1bF4aZZTrAuQXPe4C4WSq\nvMXCBqw8Opik7rMuFtdW/TGKg076997Oe1bHcCFjjYbJY/0/tJfRL8NlGzlYHAKH\nmwIDAQAB\n-----END PUBLIC KEY-----",
                //        "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xx"}]
                //    },
                //    "ac5b79accaa6da0298d56b674bfede856b8b27993a781bcc02eed41af5a3e37d": {
                //        "type": "new",
                //        "auth_address": "1CCiJ97XHgVeJrkbnzLgfXvYRr8QEWxnWF",
                //        "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqK1lnagsPFXalq9vlL5K\nqqlWBffQYUGptJH7DlLsRff+tc2W62yEQ9+ibBkerZdwrRWsG/thN0lWxeLxTuw5\nmmuF4eLsKoubH/tQJF3XrhOoUn4M7tVtGwL5aN/BG1W22l2F+Rb8Q7Tjtf3Rqdw/\nSk46CWnEZ2x1lEcj9Gl+7q7oSLocjKWURaC61zJbBmYO4Aet+/MktN0gW1VEjpPU\nr1/yEhX5EfDNwDNgOUN43aIJkv5+WcgkiGZf56ZqEauwoKsg9xB2c8v6LTv8DZlj\n+OJ/L99sVXP+QzA2yO/EQIbaCNa3Gu35GynZPoH/ig2yx0BMPu7+4/QLiIqAT4co\n+QIDAQAB\n-----END PUBLIC KEY-----",
                //        "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xxx"}]
                //    },
                //    "0613de44bde098145199b94a67f5f6a967c28f2490923af1001c82c611cebcab": {
                //        "type": "new",
                //        "auth_address": "1CCiJ97XHgVeJrkbnzLgfXvYRr8QEWxnWF",
                //        "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiANtVIyOC+MIeEhnkVfS\nn/CBDt0GWCba4U6EeUDbvf+HQGfY61e9cU+XMbI8sX7b9R5G7T+zdVqbmEIZwNEb\nDn9NIs4PVA/xqemrQUrm3qEHK8iq/+5CUwVeKeb6879FgPL8fSj1E3nNQPnmuh8N\nE+/04PraakAj9A6Z1OE5m+sfC59IDwYTKupB53kX3ZzHMmWtdYYEr08Zq9XHuYMM\nA4ykOqENGvquGjPnTB4ASKfRTLCUC+TsG5Pd+2ZswxxU3zG5v/dczj+l3GKaaxP7\nxEqA8nFYiU7LiA1MUzQlQDYj/t7ckRdjGH51GvZxlGFFaGQv3yqzs7WddZg8sqMM\nUQIDAQAB\n-----END PUBLIC KEY-----",
                //        "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xxx"}]
                //    }
                //} ;

                // insert/update/delete new contacts in local_storage_contracts (type=new)
                var found_unique_ids = [] ;
                for (i=local_storage_contracts.length-1 ; i>= 0 ; i--) {
                    if (local_storage_contracts[i].type != 'new') continue ;
                    unique_id = local_storage_contracts[i].unique_id ;
                    if (!res_hash.hasOwnProperty(unique_id)) {
                        // delete old new contact. Search words are no longer matching
                        local_storage_contracts.splice(i,1) ;
                        continue ;
                    }
                    // update old new contact with new search words
                    // todo: better for angularJS to insert/update/delete in search array?
                    found_unique_ids.push(unique_id) ;
                    local_storage_contracts[i].cert_user_id = res_hash[unique_id].cert_user_id ;
                    local_storage_contracts[i].search = res_hash[unique_id].search ;
                } // i
                for (unique_id in res_hash) {
                    if (found_unique_ids.indexOf(unique_id) != -1) continue ;
                    // insert new contact
                    local_storage_contracts.push({
                        unique_id: unique_id,
                        type: 'new',
                        auth_address: res_hash[unique_id].auth_address,
                        cert_user_id: res_hash[unique_id].cert_user_id,
                        pubkey: res_hash[unique_id].pubkey,
                        search: res_hash[unique_id].search,
                        inbox: [],
                        outbox: []
                    });
                }
                // console.log(pgm + 'local_storage_contacts = ' + JSON.stringify(local_storage_contracts));
                //local_storage_contacts = [{
                //    "unique_id": "4fef4f9678487b98baf77c6808f9a67651968534133b570677c9490406c4b5cc",
                //    "type": "new",
                //    "auth_address": "1PcU45foygsjzGmGhWSpsa7KMRnZJ4J3tr",
                //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB4k3F/Trrl31HKwlzhCqui\nEcPlRt1FaIGoeemPJ5rlhGedJfHS3DGkUOZOqgm0lGQHqAeRhktvnZcFAcrQDKkz\nWBA4m1oFBumBM3M/x/aqDDsHNFqZD4fPhz9DpEbpgHMODCZLNLh7Z88I7FOnGtih\nR3Q/h4DSa0NzGdHiYYdN69uLzZQydjByJcM18oaYIdw1xdYEgGBOFKa6gk2si3Je\nHraO9diGqsofLNFyAenVkwvFQzQbFZaJuTllSlDHpCNUFVBnIBWpGak5gxEzS7eH\npW9FXpu96pxV/ACS6EOad05SEr4V02lY5yFs87Edy+Qv6DASg49GP9J6pLOlLeaZ\nAgMBAAE=\n-----END PUBLIC KEY-----",
                //    "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "%x%"}]
                //}, {
                //    "unique_id": "12eabf2eeac1e7d21ee219a0e3b6269a1c074062877c8c9afb4d9ef4be4aa973",
                //    "type": "new",
                //    "auth_address": "15xxXSPEf1JN4a5Kna5itWbDVEZfaYTUdD",
                //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvXklRnKF3OQgF3htGDnW\nvx4+t9dvJu2gFktNi/C5PI63ej3+fH8zpa2O3o5Vuwh3ma/WyAQe7NPkl2qL3jow\nHh6d/S5o6vJ6BLBRK2/9SGvsAoKmWeRhsjmGZoIrOH5QRGY82giuEbCmtQVWQZZc\nwoBQSxAJJOULF65ebnoylXmGgFNLwj0vwCZIxx/W8W4n8pOOVcmfbRuX3H1eRmgt\nyWp0rF4bByfEjHcMhwidht60cUMSmO6yDyAgrka1LLb1bF4aZZTrAuQXPe4C4WSq\nvMXCBqw8Opik7rMuFtdW/TGKg076997Oe1bHcCFjjYbJY/0/tJfRL8NlGzlYHAKH\nmwIDAQAB\n-----END PUBLIC KEY-----",
                //    "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xx"}]
                //}, {
                //    "unique_id": "ac5b79accaa6da0298d56b674bfede856b8b27993a781bcc02eed41af5a3e37d",
                //    "type": "new",
                //    "auth_address": "1CCiJ97XHgVeJrkbnzLgfXvYRr8QEWxnWF",
                //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqK1lnagsPFXalq9vlL5K\nqqlWBffQYUGptJH7DlLsRff+tc2W62yEQ9+ibBkerZdwrRWsG/thN0lWxeLxTuw5\nmmuF4eLsKoubH/tQJF3XrhOoUn4M7tVtGwL5aN/BG1W22l2F+Rb8Q7Tjtf3Rqdw/\nSk46CWnEZ2x1lEcj9Gl+7q7oSLocjKWURaC61zJbBmYO4Aet+/MktN0gW1VEjpPU\nr1/yEhX5EfDNwDNgOUN43aIJkv5+WcgkiGZf56ZqEauwoKsg9xB2c8v6LTv8DZlj\n+OJ/L99sVXP+QzA2yO/EQIbaCNa3Gu35GynZPoH/ig2yx0BMPu7+4/QLiIqAT4co\n+QIDAQAB\n-----END PUBLIC KEY-----",
                //    "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xxx"}]
                //}, {
                //    "unique_id": "0613de44bde098145199b94a67f5f6a967c28f2490923af1001c82c611cebcab",
                //    "type": "new",
                //    "auth_address": "1CCiJ97XHgVeJrkbnzLgfXvYRr8QEWxnWF",
                //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiANtVIyOC+MIeEhnkVfS\nn/CBDt0GWCba4U6EeUDbvf+HQGfY61e9cU+XMbI8sX7b9R5G7T+zdVqbmEIZwNEb\nDn9NIs4PVA/xqemrQUrm3qEHK8iq/+5CUwVeKeb6879FgPL8fSj1E3nNQPnmuh8N\nE+/04PraakAj9A6Z1OE5m+sfC59IDwYTKupB53kX3ZzHMmWtdYYEr08Zq9XHuYMM\nA4ykOqENGvquGjPnTB4ASKfRTLCUC+TsG5Pd+2ZswxxU3zG5v/dczj+l3GKaaxP7\nxEqA8nFYiU7LiA1MUzQlQDYj/t7ckRdjGH51GvZxlGFFaGQv3yqzs7WddZg8sqMM\nUQIDAQAB\n-----END PUBLIC KEY-----",
                //    "search": [{"my_tag": "Name", "my_value": "%x%", "other_tag": "Name", "other_value": "xxx"}]
                //}];

                // refresh contacts in angularJS UI
                fnc_when_ready() ;

            });
        }) ;

    } // zeronet_contact_search


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
        // basic authorization - see client_login
        key: {session: false, userid: true, compress: true, encrypt: true}, // random password - used for localStorage encryption
        password: {session: true, userid: false, compress: false, encrypt: false}, // session password in clear text
        passwords: {session: false, userid: false, compress: false, encrypt: false}, // array with hashed passwords. size = number of accounts
        prvkey: {session: false, userid: true, compress: true, encrypt: true}, // for encrypted user to user communication
        pubkey: {session: false, userid: true, compress: true, encrypt: false}, // for encrypted user to user communication
        userid: {session: true, userid: false, compress: false, encrypt: false}, // session userid (1, 2, etc) in clear text.
        // user data
        user_info: {session: false, userid: true, compress: true, encrypt: true}, // array with user_info. See user sub page / userCtrl
        contacts: {session: false, userid: true, compress: true, encrypt: true}, // array with contacts. See contacts sub page / contactCtrl
        msg_seq: {session: false, userid: true, compress: true, encrypt: true}, // local msg seq. Used in messages array
        messages: {session: false, userid: true, compress: true, encrypt: true} // array with messages. See contacts sub page / contactCtrl
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
            if (session) session_storage[key] = value; // sessionStorage.setItem(key, value);
            else local_storage[key] = value ; // localStorage.setItem(key, value);
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
                if (session) session_storage[key] = value; // sessionStorage.setItem(key, value);
                else local_storage[key] = value ; // localStorage.setItem(key, value);
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
        // console.log(pgm + 'debug 1: key = ' + key) ;
        var pseudo_key = key; // .match(/^gift_[0-9]+$/) ? 'gifts' : key ; // use gifts rule for gift_1, gift_1 etc
        var rule = get_local_storage_rule(pseudo_key);
        if (rule.encrypt) var password_type = (key == 'key' ? 'password' : 'key'); // key is as only variable encrypted with human password
        // userid prefix?
        if (rule.userid) {
            var userid = getItem('userid');
            if ((typeof userid == 'undefined') || (userid == null) || (userid == '')) userid = 0;
            else userid = parseInt(userid);
            if (userid == 0) {
                console.log(pgm + 'Error. key ' + key + ' is stored with userid prefix but userid was not found (not logged in)') ;
                return null;
            }
            key = userid + '_' + key;
        }
        // read stored value
        // console.log(pgm + 'key = ' + key + ', rule.session = ' + rule.session + ', local_storage.loading = ' + local_storage.loading);
        if (!rule.session && local_storage.loading) {
            console.log(pgm + 'LocalStorage are not ready. key = ' + key) ;
            return null ;
        }
        var value = rule.session ? session_storage[key] : local_storage[key]; // localStorage.getItem(key);
        // if (pseudo_key == 'user_info') console.log(pgm + 'debug: local_storage = ' + JSON.stringify(local_storage) + ', value = ' + value) ;
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
        // console.log(pgm + 'key = ' + key + ', value = ' + value) ;
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
        // if (pseudo_key == 'user_info') console.log(pgm + 'debug: key = ' + key + ', value = ' + value) ;
        value = storage_flag + value;
        // save
        // if (key.match(/oauth/)) console.log('setItem. key = ' + key + ', value = ' + value) ;
        if (rule.session) session_storage[key] = value; // sessionStorage.setItem(key, value);
        else local_storage[key] = value; // localStorage.setItem(key, value);
        // optimize compression for saved value

        // todo: disabled until I find a method to convert byte array returned from LZMA.compress into an valid utf-16 string
        // check if lzma compress if better than lzstring compress
        // if (rule.compress) lzma_compress0(key, save_value, rule.session, password, value.length-1) ;
    } // setItem

    function removeItem(key) {
        var pgm = 'MoneyNetworkHelper.setItem: ';
        var pseudo_key = key.match(/^gift_[0-9]+$/) ? 'gifts' : key; // use gifts rule for gift_1, gift_1 etc
        var rule = get_local_storage_rule(pseudo_key);
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
        if (rule.session) delete session_storage[key]; // sessionStorage.removeItem(key);
        else delete local_storage[key]; // localStorage.removeItem(key);
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
        var pgm = module + '.client_login: ' ;
        var password_sha256, passwords_s, passwords_a, i, userid, did, crypt, pubkey, prvkey, prvkey_aes, giftid_key;
        password_sha256 = sha256(password);
        // passwords: array with hashed passwords. size = number of accounts
        passwords_s = getItem('passwords');
        // console.log(pgm + 'passwords_s = ' + passwords_s) ;
        if ((passwords_s == null) || (passwords_s == '')) passwords_a = [];
        else passwords_a = JSON.parse(passwords_s);
        // console.log(pgm + 'password_sha256 = ' + password_sha256) ;
        // check old accounts
        for (i = 0; i < passwords_a.length; i++) {
            // console.log(pgm + 'passwords_a[' + i + '] = ' + passwords_a[i]) ;
            if (password_sha256 == passwords_a[i]) {
                // log in ok - account exists
                // console.log(pgm + 'login ok') ;
                userid = i + 1;
                // save login
                setItem('userid', userid);
                setItem('password', password);
                return userid;
            }
        }
        // password was not found
        if (create_new_account) {
            // create new account
            console.log(pgm + 'create new account');
            userid = passwords_a.length + 1; // sequence = number of user accounts in local storage
            // setup new account
            passwords_a.push(password_sha256);
            passwords_s = JSON.stringify(passwords_a);
            // generate key pair for client to client RSA encryption
            crypt = new JSEncrypt({default_key_size: 2048});
            crypt.getKey();
            pubkey = crypt.getPublicKey();
            prvkey = crypt.getPrivateKey();
            console.log(pgm + 'new pubkey = ' + pubkey);
            console.log(pgm + 'new prvkey = ' + prvkey);
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
            // send local storage updates to ZeroFrame
            local_storage_save();
            return userid;
        }
        // invalid password (create_new_account=false)
        // console.log(pgm + 'invalid password');
        return 0;
    } // client_login


    // client logout
    function client_logout() {
        removeItem('password');
        removeItem('userid');
    } // client_logout


    // validate JSON before send and after receive using https://github.com/geraintluff/tv4
    var json_schemas = {} ;
    json_schemas['contact added'] = {
        "type": 'object',
        "title": 'Contact added message. Message with additional user information',
        "properties": {
            "msgtype": { "type": 'string', pattern: '^contact added$'},
            "search": {
                "type": 'array',
                "items": {
                    "type": 'object',
                    "properties": {
                        "tag": { "type": 'string' },
                        "value": { "type": 'string'},
                        "privacy": { "type": 'string', "pattern": '^(Public|Unverified)$'},
                    },
                    "required": ['tag', 'value', 'privacy'],
                    "additionalProperties": false
                },
                "minItems": 1
            },
            "sender_sha256": { "type": 'string', "pattern": '^[0-9a-f]{64}$'}
        },
        "required": ['msgtype', 'search'],
        "additionalProperties": false
    }; // contact added


    // validate json:
    // - pgm - calling function. for debug messages
    // - msg - additional info in case of errors
    function validate_json (pgm, json, json_schema, msg) {
        console.log(pgm + 'validating json');
        if (!msg) msg = '' ;
        // remove any null keys before checking json
        for (var key in json) if (json[key] == null) delete json[key];
        // check if schema definition exists
        var error ;
        if (!json_schemas.hasOwnProperty(json_schema)) {
            console.log(pgm + 'Error. JSON schema defintion for ' + json_schema + ' was not found.');
            error = 'JSON schema definition "' + json_schema + '" was not found. ' + msg ;
            console.log(pgm + error);
            return error;
        }
        // validate json
        if (tv4.validate(json, json_schemas[json_schema])) return null;
        // report json error
        var json_error = JSON.parse(JSON.stringify(tv4.error));
        delete json_error.stack;
        var json_errors = JSON.stringify(json_error) ;
        error = 'Error in ' + json_schema + ' JSON. ' + msg ;
        console.log(pgm + error + json_errors);
        return error + '.<br>Error ' + json_errors ;
    } // validate_json


    // export helpers
    return {
        // local storage helpers
        zeronet_contact_search: zeronet_contact_search,
        getItem: getItem,
        setItem: setItem,
        removeItem: removeItem,
        local_storage_bind: local_storage_bind,
        local_storage_save: local_storage_save,
        getUserId: getUserId,
        client_login: client_login,
        client_logout: client_logout,
        generate_random_password: generate_random_password,
        encrypt: encrypt,
        decrypt: decrypt,
        validate_json: validate_json
    };
})();
// MoneyNetworkHelper end


// angularJS app
angular.module('MoneyNetwork', ['ngRoute', 'ngSanitize', 'ui.bootstrap'])

    .config(['$routeProvider', function ($routeProvider) {

        // resolve: check if user is logged. check is used in multiple routes
        var check_auth_resolve = ['$location', function ($location) {
            if (!MoneyNetworkHelper.getUserId()) {
                ZeroFrame.cmd("wrapperNotification", ['info', 'Not allowed. Please log in', 3000]);
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
            .when('/chat/:unique_id', {
                templateUrl: 'chat.html',
                controller: 'ChatCtrl as c',
                resolve: {check_auth: check_auth_resolve}
            })
            .when('/contacts', {
                templateUrl: 'contacts.html',
                controller: 'ContactCtrl as c',
                resolve: {check_auth: check_auth_resolve}
            })
            .when('/home', {
                templateUrl: 'home.html',
                resolve: {check_auth: check_auth_resolve}
            })
            .when('/logout', {
                resolve: {
                    logout: ['$location', function ($location) {
                        if (MoneyNetworkHelper.getUserId()) ZeroFrame.cmd("wrapperNotification", ['done', 'Log out OK', 3000]) ;
                        else ZeroFrame.cmd("wrapperNotification", ['info', 'Already logged out', 3000]);
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


    .factory('MoneyNetworkService', ['$timeout', '$rootScope', function($timeout, $rootScope) {
        var self = this;
        var service = 'MoneyNetworkService' ;
        console.log(service + ' loaded') ;

        // startup tag cloud. Tags should be created by users and shared between contacts.
        // Used in typeahead autocomplete functionality http://angular-ui.github.io/bootstrap/#/typeahead
        var tags = ['Name', 'Email', 'Phone', 'Photo', 'Company', 'URL', 'GPS'];
        function get_tags() {
            return tags ;
        }

        // convert data.json to newest version. compare dbschema.schema_changed and data.version.
        function zeronet_migrate_data (json) {
            var pgm = service + '.zeronet_migrate_data: ' ;
            if (!json.version) json.version = 1 ;
            var dbschema_version = 4 ;
            if (json.version == dbschema_version) return ;
            var i ;
            // data.json version 1
            // missing multiple users support. there are following problems in version 1:
            //   a) there can be multiple user accounts in a client
            //   b) one client can connect to other ZeroNet accounts
            //   c) one ZeroNet user can use multiple devices
            //{ "sha256": "5874fe64f6cb50d2410b7d9e1031d4403531d796a70968a3eabceb71721af0fc",
            //  "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB5lpAS1uVBKhoo/W3Aas17\nns/VXuaIrAQfvAF30yCH+j5+MoyqMib9M0b6mWlLFnSvk/zrZYUyCXf1PrtYDqtn\nsXulIYEhdKsjkAmnfSeL3CofQu8tl3fxbr1r2hj/XyWPwo3oTsamoyMaFlJLrOsl\n/+IOZswP6IdgNVNa8Xs2UDM3w9TWisCScsHJDw7i7fSJdhFVdQvlFhfhWHHdcXAz\nmBA2oQaNtbOukKS16F4WVPN5d00R13iqqL9AXEYrWs0tggYQ+KKyO2+kRLFUDj8z\nWm2BdvRgfHTqxViEa4eFf+ceukpobnZdStjdxJW9jk4Q2Iiw6CLv+CrtSiz7tMzv\nAgMBAAE=\n-----END PUBLIC KEY-----",
            //  "search": [{ "tag": "name", "value": "xxxx", "time": 1475175779840 }]
            //};
            if (json.version == 1) {
                // convert from version 1 to 2
                // add users array
                console.log(pgm + 'json version 1 = ' + JSON.stringify(json)) ;
                json.users = [{ user_seq: 1, sha256: json.sha256, pubkey: json.pubkey}] ;
                delete json.sha256 ;
                delete json.pubkey ;
                // add user_seq to search array
                if (!json.search) json.search = [] ;
                for (i=0 ; i<json.search.length ; i++) json.search[i].user_seq = 1 ;
                json.version = 2 ;
            }
            // data.json version 2. minor problems:
            // a) remove time from search array. use modified from content.json (keyvalues table)
            // b) remove sha256 from users (can always be calculated from public key)
            // { "search": [
            //     {"user_seq": 3, "tag": "Name", "value": "xxx", "time": 1475318394228},
            //     {"user_seq": 4, "tag": "Name", "value": "xxx", "time": 1475318987160} ],
            //   "version": 2,
            //   "users": [
            //     {"user_seq": 1, "sha256": "97526f811cd0e93cfa77d9558a367238132bf5f8966c93fc88931eac574d6980", "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnwCwB9wCrtZK6QoTXj4D\nQelvBWqay0l07yqKF1NBh7Hr2PNmxy2OuTGyQp8KtdL8IwqNGFyiU72ig6zHoSgA\nsmWoPcwG3XLOvzb2o4LC9dY5E0KrW+wMoiRWNloVriKavUF4FwNeTCN5Q3o0+g2W\nHvSPq8Oz06d11BUtDJ88eVu+TeHC+Wk/JYXdcOnQf9cxM+wZSrDvTLXoyjtsFxWe\nUV3lE03Xss2SSOCggR5tmht9G6D68JB0rOKe6VcQ0tbHO292P0EMNOydcoJn0Edw\nzAdFo/XkQLXC/Cl4XDuE/RD1qH+1O7C4Bs9eG2EBdgmzvM5HqbvmvvYZzUDBgFuZ\nmQIDAQAB\n-----END PUBLIC KEY-----"},
            //     {"user_seq": 2, "sha256": "8bec70849d1531948c12001f11a928862732e661fbf0708aa404d94eeaab99bf", "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAr2OsRJv06+Iap7YfFAtk\nzSmkDNPyN6fNcKJuSmPLRa2p4kh4WhHrJLuqua9jD42MkH3BkD3qcDhYqaGZvH9i\nPxxg8uYdl+XZuTsUfjTnWaaQODX/9Dgy75Ow+0H5DbmJKTAESREiqwegNkXyYuje\nN2UhXiLFaDsXz8OXgKOEBFei5r/EXcRKTCytglubuu7skxLrV/AQ8a+/+JcwI4a7\n3ezaSjeopHiglZi2h8U1wPuAopvjh+B107WctGV1iUv0I8yzbaUgkllTouL1hrr3\n1tR4TYMTuoReT+l+dqPyOKjKDai02Fb9ZZydtNmF2R33uFp4gPLTUoAwh7r//SW/\njwIDAQAB\n-----END PUBLIC KEY-----"},
            //     {"user_seq": 3, "sha256": "94a4f3887315a7bb01d836ecb6e15502c707865ff108b47ea05fa7bced794f3e", "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqK1lnagsPFXalq9vlL5K\nqqlWBffQYUGptJH7DlLsRff+tc2W62yEQ9+ibBkerZdwrRWsG/thN0lWxeLxTuw5\nmmuF4eLsKoubH/tQJF3XrhOoUn4M7tVtGwL5aN/BG1W22l2F+Rb8Q7Tjtf3Rqdw/\nSk46CWnEZ2x1lEcj9Gl+7q7oSLocjKWURaC61zJbBmYO4Aet+/MktN0gW1VEjpPU\nr1/yEhX5EfDNwDNgOUN43aIJkv5+WcgkiGZf56ZqEauwoKsg9xB2c8v6LTv8DZlj\n+OJ/L99sVXP+QzA2yO/EQIbaCNa3Gu35GynZPoH/ig2yx0BMPu7+4/QLiIqAT4co\n+QIDAQAB\n-----END PUBLIC KEY-----"},
            //     {"user_seq": 4, "sha256": "0f5454007ceee575e63b52058768ff1bc0f1cb79b883d0dcf6a920426836c2c7", "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiANtVIyOC+MIeEhnkVfS\nn/CBDt0GWCba4U6EeUDbvf+HQGfY61e9cU+XMbI8sX7b9R5G7T+zdVqbmEIZwNEb\nDn9NIs4PVA/xqemrQUrm3qEHK8iq/+5CUwVeKeb6879FgPL8fSj1E3nNQPnmuh8N\nE+/04PraakAj9A6Z1OE5m+sfC59IDwYTKupB53kX3ZzHMmWtdYYEr08Zq9XHuYMM\nA4ykOqENGvquGjPnTB4ASKfRTLCUC+TsG5Pd+2ZswxxU3zG5v/dczj+l3GKaaxP7\nxEqA8nFYiU7LiA1MUzQlQDYj/t7ckRdjGH51GvZxlGFFaGQv3yqzs7WddZg8sqMM\nUQIDAQAB\n-----END PUBLIC KEY-----"}
            //   ]
            // }
            // import_cols filter (http://zeronet.readthedocs.io/en/latest/site_development/dbschema_json/) does not work
            // cannot drop the two columns and import old data. the two fields were manually removed from data.json files (only 16)
            if (json.version == 2) {
                // convert from version 2 to 3
                for (i=0 ; i<json.users.length ; i++) delete json.users[i].sha256 ;
                for (i=0 ; i<json.search.length ; i++) delete json.search[i].time ;
                json.version = 3 ;
            }
            // data.json version 3.
            // { "search": [
            //     {"user_seq": 3, "tag": "Name", "value": "xxx"},
            //     {"user_seq": 4, "tag": "Name", "value": "xxx"},
            //     {"user_seq": 5, "tag": "Name", "value": "%'%"} ],
            //   "version": 3,
            //   "users": [
            //     {"user_seq": 3, "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqK1lnagsPFXalq9vlL5K\nqqlWBffQYUGptJH7DlLsRff+tc2W62yEQ9+ibBkerZdwrRWsG/thN0lWxeLxTuw5\nmmuF4eLsKoubH/tQJF3XrhOoUn4M7tVtGwL5aN/BG1W22l2F+Rb8Q7Tjtf3Rqdw/\nSk46CWnEZ2x1lEcj9Gl+7q7oSLocjKWURaC61zJbBmYO4Aet+/MktN0gW1VEjpPU\nr1/yEhX5EfDNwDNgOUN43aIJkv5+WcgkiGZf56ZqEauwoKsg9xB2c8v6LTv8DZlj\n+OJ/L99sVXP+QzA2yO/EQIbaCNa3Gu35GynZPoH/ig2yx0BMPu7+4/QLiIqAT4co\n+QIDAQAB\n-----END PUBLIC KEY-----"},
            //     {"user_seq": 4, "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiANtVIyOC+MIeEhnkVfS\nn/CBDt0GWCba4U6EeUDbvf+HQGfY61e9cU+XMbI8sX7b9R5G7T+zdVqbmEIZwNEb\nDn9NIs4PVA/xqemrQUrm3qEHK8iq/+5CUwVeKeb6879FgPL8fSj1E3nNQPnmuh8N\nE+/04PraakAj9A6Z1OE5m+sfC59IDwYTKupB53kX3ZzHMmWtdYYEr08Zq9XHuYMM\nA4ykOqENGvquGjPnTB4ASKfRTLCUC+TsG5Pd+2ZswxxU3zG5v/dczj+l3GKaaxP7\nxEqA8nFYiU7LiA1MUzQlQDYj/t7ckRdjGH51GvZxlGFFaGQv3yqzs7WddZg8sqMM\nUQIDAQAB\n-----END PUBLIC KEY-----"},
            //     {"user_seq": 5, "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoqZdclttbcat2VlMLrbj\ndtlfJIYX0kdS+ueh6XS5LbU2Ge6kfNkfkUUtfd7Gz/AAHLIdCZyGBNqHPJ2+635y\n81N0UHStLFL24e6tr0enQ4QLWHAm8ouU3j0LR1WvF2JIUVlGtNE7xcm2nV3rRht0\nlQBae8kz8iLNtFMbNE9Xz2mJddqXdDTll1PrJeYko5MfwL0I+ur/l8RCeDXHvdJE\nRsQHr+rbkoIqiFid9h8PpIHLx2CMQp/Kcvs1+6buna2boOkW9WfICsH/u1zOvS47\nd6/lqMcrBoMGyozMr//1FtCS2DH3mTsmDUS9l6g5I8vUVh/uKd/OwpO12KNp9cLh\nvwIDAQAB\n-----END PUBLIC KEY-----"}
            //   ]
            // }
            // new requirements:
            // a) add empty msg array
            if (json.version == 3) {
                // convert from version 3 to 4
                json.msg = [] ;
                json.version = 4 ;
            }
            if (json.version == 4) {
                // convert from version 4 to 5
            }
            if (json.version == 5) {
                // convert from version 5 to 6
            }
            // etc
            console.log(pgm + 'json version ' + json.version + ' = ' + JSON.stringify(json)) ;

            return ;
        } // zeronet_migrate_data


        function generate_random_password () {
            return MoneyNetworkHelper.generate_random_password(200);
        }

        // keep track of ZeroNet fileGet/fileWrite operations. fileWrite must finish before next fileGet
        var zeronet_file_locked = {} ;

        // update user_info (search words) on ZeroNet
        function zeronet_update_user_info (lock_pgm) {
            var pgm = service + '. zeronet_update_user_info: ' ;
            // console.log(pgm + 'start') ;

            // check if auto generate cert + login in ZeroFrame was OK
            if (!ZeroFrame.site_info.cert_user_id) {
                ZeroFrame.cmd("wrapperNotification", ["error", "Ups. Something is wrong. Not logged in on ZeroNet. Cannot post search words in Zeronet. siteInfo.cert_user_id is null", 10000]);
                console.log(pgm + 'site_info = ' + JSON.stringify(ZeroFrame.site_info));
                return ;
            }

            //var user_info = getItem('user_info');
            //if (!user_info) user_info = [] ;
            //else user_info = JSON.parse(user_info) ;
            var pubkey = MoneyNetworkHelper.getItem('pubkey') ;
            // console.log(pgm + 'user_info = ' + JSON.stringify(user_info)) ;
            // console.log(pgm + 'pubkey = ' + pubkey);
            // console.log(pgm + 'create/update json with search words') ;
            var data_inner_path = "data/users/" + ZeroFrame.site_info.auth_address + "/data.json";
            var content_inner_path = "data/users/" + ZeroFrame.site_info.auth_address + "/content.json";

            if (zeronet_file_locked[data_inner_path]) {
                throw pgm +
                "Error. File " + data_inner_path + ' is being updated by an other process. ' +
                'Process with lock is ' + zeronet_file_locked[data_inner_path] + '. Process requesting lock is ' + lock_pgm ;
                return ;
            }
            zeronet_file_locked[data_inner_path] = lock_pgm ;

            // update json table with public key and search words
            // console.log(pgm + 'calling fileGet');
            ZeroFrame.cmd("fileGet", {inner_path: data_inner_path, required: false}, function (data) {
                var pgm = service + '.zeronet_update_user_info fileGet callback: ' ;
                // console.log(pgm + 'data = ' + JSON.stringify(data));
                var json_raw, row;
                if (data) {
                    data = JSON.parse(data);
                    zeronet_migrate_data(data);
                }
                else data = {
                    version: 4,
                    users: [],
                    search: [],
                    msg: []
                };
                // find current user in users array
                var max_user_seq = 0, i, user_i, user_seq ;
                for (i=0 ; i<data.users.length ; i++) {
                    if (pubkey == data.users[i].pubkey) {
                        user_i = i ;
                        user_seq = data.users[user_i].user_seq
                    }
                    else if (data.users[i].user_seq > max_user_seq) max_user_seq = data.users[i].user_seq ;
                }
                if (!user_seq && (user_info.length > 0)) {
                    // add current user to data.users array
                    user_seq = max_user_seq + 1 ;
                    data.users.push({
                        user_seq: user_seq,
                        pubkey: pubkey
                    }) ;
                    // console.log(pgm + 'added user to data.users. data = ' + JSON.stringify(data)) ;
                }
                // console.log(pgm + 'pubkey = ' + pubkey + ', user_seq = ' + user_seq);

                // remove old search words from search array
                var user_no_search_words = {} ;
                for (i=data.search.length-1 ; i>=0 ; i--) {
                    row = data.search[i] ;
                    if (row.user_seq == user_seq) data.search.splice(i,1);
                    else {
                        if (!user_no_search_words.hasOwnProperty(row.user_seq)) user_no_search_words[row.user_seq] = 0 ;
                        user_no_search_words[row.user_seq]++ ;
                    }
                }
                // console.log(pgm + 'removed old rows for user_seq ' + user_seq + ', data = ' + JSON.stringify(data));
                // add new search words to search array
                user_no_search_words[user_seq] = 0 ;
                for (i=0 ; i<user_info.length ; i++) {
                    if (user_info[i].privacy != 'Search') continue ;
                    row = {
                        user_seq: user_seq,
                        tag: user_info[i].tag,
                        value: user_info[i].value
                    };
                    data.search.push(row);
                    user_no_search_words[user_seq]++ ;
                } // for i
                // console.log(pgm + 'user_no_search_words = ' + JSON.stringify(user_no_search_words));
                // remove users without any search words
                // can be deleted users (clear local storage) or can be users done searching for contacts
                for (i=data.users.length-1 ; i >= 0 ; i--) {
                    user_seq = data.users[i].user_seq ;
                    if (!user_no_search_words.hasOwnProperty(user_seq) || (user_no_search_words[user_seq] == 0)) {
                        data.users.splice(i, 1);
                        // console.log(pgm + 'removed user ' + user_seq + ' from users array');
                    }
                }

                // console.log(pgm + 'todo: insert/update/delete data.msg from localStorage array messages');
                var local_storage_updated = false ;
                //var messages = getItem('messages');
                //if (!messages) messages = [] ;
                //else messages = JSON.parse(messages);
                // console.log(pgm + 'localStorage.messages (1) = ' + JSON.stringify(local_storage_messages));
                // console.log(pgm + 'ZeroNet data.msg (1) = ' + JSON.stringify(data.msg));
                //messages = [
                //    {"local_msg_seq":1,
                //        "zeronet_msg_sha256":null,
                //        "contact_id":"af55bca34e35924d16767fbb2caa8d610812d68ccef95f58eea8be08d2fa1c6f",
                //        "receiver_sha256":"1b15736f7cf72522eb36b478cfb6d0ebce2461b6c5bf141df689a9319abc3065",
                //        "pubkey":"-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7KQHhBKw7wN+rCMQ2p8+\nhhdqpLs3h9qbZbHmed3No0M53Obh8oK45rD1k/7tx24P04DknPfq0zuOCf6qGUoW\naxSnHtwa/4GG/CVL1qM9guiIsVggkyOGEU1oUajfNGMIBfbGGGZ1QQne6bPjfAyl\nc10rBIhlPAZ5Sb7OeTxZMjxNwsal4g9lxB+hcaZfriOXs/8bbav7MuM6AcCjWuFw\ncUa2uN4FparwJicleccvTvNrTaS+OPy5Rbb5vazLC6bn67Kchol7fxK2PGjHrx3n\nhzfXD4eyDuUkMlcKNqTJjy8MI0xrec/arUE+bePp7MQPwOQ/VrJ+Xuu6qyK6VJ8n\nkwIDAQAB\n-----END PUBLIC KEY-----",
                //        "message":{"type":"add","search":[]},
                //        "send_at":1475909700008
                //    }]

                // todo: fix problem with false/0 keys in msg array / messages table (cannot be decrypted). See also "insert new message" below
                var j, k, contact ;
                for (i=data.msg.length-1 ; i>=0 ; i--) {
                    if (!data.msg[i].key) {
                        console.log(pgm + 'deleting message with invalid key. data.msg[' + i + '] = ' + JSON.stringify(data.msg[i]));
                        // cleanup invalid zeronet_msg_id references in localStorage
                        for (j=0 ; j<local_storage_contracts.length ; j++) {
                            contact = local_storage_contracts[j] ;
                            for (k=0 ; k<contact.outbox.length ; k++) {
                                if (contact.outbox[k].zeronet_msg_id == data.msg[i].message_sha256) {
                                    delete contact.outbox[k].zeronet_msg_id;
                                    local_storage_updated = true;
                                }
                            } // for k (outbox)
                        } // for j (contacts)
                        data.msg.splice(i,1);
                    } // if
                } // for i (data.msg)

                // insert & delete messages
                var password, key, message, message_deleted, error, receiver_sha256 ;
                for (i=0 ; i<local_storage_contracts.length ; i++) {
                    contact = local_storage_contracts[i] ;
                    for (j=contact.outbox.length-1 ; j >= 0 ; j--) {
                        if (!contact.outbox[j].send_at && !contact.outbox[j].deleted_at) {
                            // not yet sent and not deleted - encrypt and insert new message in data.msg array (data.json)
                            var encrypt = new JSEncrypt();
                            encrypt.setPublicKey(contact.pubkey);
                            // console.log(pgm + 'encrypting using pubkey ' + contact.pubkey) ;
                            delete contact.outbox[j].pubkey ;
                            // random sender_sha256 address? - sha256(pubkey) should only be used for first message (contact added)
                            if (contact.outbox[j].sender_sha256) {
                                contact.outbox[j].sender_sha256 = CryptoJS.SHA256(generate_random_password()).toString();
                                contact.outbox[j].message.sender_sha256 = contact.outbox[j].sender_sha256 ;
                            }
                            else delete contact.outbox[j].sender_sha256 ;
                            // rsa encrypted key, symmetric encrypted message
                            password = generate_random_password();

                            // todo: debugging - fix problem with false/ "0" keys in msg array / messages table. See data cleanup above
                            key = encrypt.encrypt(password);
                            // console.log(pgm + 'password = ' + password + ', key = ' + key);
                            if (!key) {
                                delete zeronet_file_locked[data_inner_path] ;
                                throw pgm + 'System error. Encryption error. key = ' + key + ', password = ' + password ;
                                return ;
                            }
                            message = MoneyNetworkHelper.encrypt(JSON.stringify(contact.outbox[j].message), password);
                            // console.log(pgm + 'message = ' + JSON.stringify(contact.outbox[j].message)) ;
                            // console.log(pgm + 'encrypted message = ' + message) ;

                            delete contact.outbox[j].message.sender_sha256 ;
                            contact.outbox[j].zeronet_msg_id = CryptoJS.SHA256(message).toString();
                            contact.outbox[j].send_at = new Date().getTime() ;
                            receiver_sha256 = contact.outbox[j].receiver_sha256 ;
                            delete contact.outbox[j].receiver_sha256 ; // no need to known after message has been sent
                            // console.log(pgm + 'new local_storage_messages[' + i + '] = ' + JSON.stringify(contact.outbox[j]));
                            //local_storage_messages[3] = {
                            //    "local_msg_seq": 15,
                            //    "contact_id": "af55bca34e35924d16767fbb2caa8d610812d68ccef95f58eea8be08d2fa1c6f",
                            //    "message": {"msg": "contact added", "search": []},
                            //    "sender_sha256": "252b735ca19123f4ace146e706ef06dca3a13c8414e7ffe61dc393d719c036f4",
                            //    "zeronet_msg_id": "b6baac49e244324ce1bfba7cb9d3601c0fcbcd9a816a3dfd31c5cce1087f70b8",
                            //    "send_at": 1476005958406
                            //};
                            // console.log(pgm + 'old data.msg.length = ' + data.msg.length) ;
                            data.msg.push({
                                user_seq: user_seq,
                                receiver_sha256: receiver_sha256,
                                key: key,
                                message: message,
                                message_sha256: contact.outbox[j].zeronet_msg_id,
                                timestamp: contact.outbox[j].send_at
                            });
                            // console.log(pgm + 'new data.msg row = ' + JSON.stringify(data.msg[data.msg.length-1]));
                            // console.log(pgm + 'new data.msg.length = ' + data.msg.length) ;
                            local_storage_updated = true ;
                            continue ;
                        } // if
                        if (contact.outbox[j].zeronet_msg_id && contact.outbox[j].deleted_at) {
                            // delete message requested by client (active delete)
                            // console.log(pgm + 'debug: delete message requested by client (active delete)') ;
                            // console.log(pgm + 'local_storage_messages[' + i + '] = ' + JSON.stringify(contact.outbox[j])) ;
                            message_deleted = false ;
                            // console.log(pgm + 'old data.msg.length = ' + data.msg.length) ;
                            for (k=data.msg.length-1 ; k>=0 ; k--) {
                                // console.log(pgm + 'debug: data.msg[' + k + '] = ' + JSON.stringify(data.msg[k])) ;
                                if ((data.msg[k].user_seq == user_seq) && (data.msg[k].message_sha256 == contact.outbox[j].zeronet_msg_id)) {
                                    message_deleted = true ;
                                    data.msg.splice(k,1) ;
                                }
                            }
                            // console.log(pgm + 'new data.msg.length = ' + data.msg.length) ;
                            if (!message_deleted) {
                                error = "Could not delete message from Zeronet. Maybe posted in ZeroNet from an other ZeroNet id" ;
                                console.log(pgm + 'error = ' + error) ;
                                console.log(pgm + 'user_seq = ' + user_seq) ;
                                console.log(pgm + 'zeronet_msg_id = ' + contact.outbox[j].zeronet_msg_id) ;
                                // console.log(pgm + 'data.msg = ' + JSON.stringify(data.msg));
                                ZeroFrame.cmd("wrapperNotification", ["error", error, 5000]);
                                delete contact.outbox[j].zeronet_msg_id ;
                            }
                            contact.outbox.splice(j,1);
                            local_storage_updated = true ;
                        } // if
                    } // for j (contact.outbox)
                } // for i (contacts)

                // console.log(pgm + 'localStorage.messages (2) = ' + JSON.stringify(local_storage_messages));
                // console.log(pgm + 'ZeroNet data.msg (2) = ' + JSON.stringify(data.msg));

                // delete old messages from Zeronet.
                var now = new Date().getTime() ;
                var one_week_ago = now - 1000*60*60*24*7 ;
                for (i=data.msg.length-1 ; i>=0 ; i--) {
                    if (data.msg[i].timestamp > one_week_ago) continue ;
                    // clear reference from localStorage to data.json on ZeroNet
                    for (j=0 ; j<local_storage_contracts.length ; j++) {
                        contact = local_storage_contracts[j] ;
                        for (k=0 ; k<contact.outbox.length ; k++) {
                            if (contact.outbox[k].zeronet_msg_id == data.msg[i].message_sha256) {
                                contact.outbox[k].deleted_at = now ;
                                delete contact.outbox[k].zeronet_msg_id ;
                                local_storage_updated = true ;
                            } // if
                            
                        } // for k (contact.outbox)
                    } // for j (contacts)
                    data.msg.splice(i,1) ;
                } // for i

                // check file size. Try to keep data.json file size small for fast communication and small site
                // always keep msg for least hour
                var one_hour_ago = now - 1000*60*60 ;
                var msg_user_seqs ;
                var my_pubkey = MoneyNetworkHelper.getItem('pubkey') ;
                var my_pubkey_sha256 = CryptoJS.SHA256(my_pubkey).toString();
                var inbox_message, outbox_message, zeronet_message ;
                while (true) {
                    json_raw = unescape(encodeURIComponent(JSON.stringify(data, null, "\t")));
                    if (json_raw.length < 10000) break ; // OK - small file
                    console.log(pgm + 'data.json is big. size ' + json_raw.length + '. removing old data ...') ;

                    // a) delete users without any messages (not current user)
                    msg_user_seqs = [] ;
                    if (!data.msg) data.msg = [] ;
                    if (!data.search) data.search = [] ;
                    for (i=0 ; i<data.msg.length ; i++) {
                        if (msg_user_seqs.indexOf(data.msg[i].user_seq) == -1) msg_user_seqs.push(data.msg[i].user_seq) ;
                    }
                    for (i=data.users.length-1 ; i>=0 ; i--) {
                        if (data.users[i].user_seq == user_seq) continue ;
                        if (msg_user_seqs.indexOf(data.users[i].user_seq) != -1) continue ;
                        // remove search words
                        for (j=data.search.length-1 ; j>=0 ; j--) {
                            if (data.search[j].user_seq == data.users[i].user_seq) data.search.splice(j,1);
                        }
                        // remove user and recheck file size
                        data.users.splice(i,1);
                        console.log(pgm + 'data.json is big. removed user without any messages') ;
                        continue ;
                    } // for i (users)

                    // b) cleanup msg that has been received by other contacts
                    //    outbox.msg1.sender_sha256 == inbox.msg2.receiver_sha256
                    //    ingoing msg2 is a response using sender_sha256 from outgoing msg1
                    //    delete outbox.msg1 from data.msg array if not already done
                    for (i=0 ; i<local_storage_contracts.length ; i++) {
                        contact = local_storage_contracts[i] ;
                        if (!contact.inbox) continue ;
                        for (j=0 ; j<contact.inbox.length ; j++) {
                            inbox_message = contact.inbox[j] ;
                            if (!inbox_message.receiver_sha256) continue ;
                            if (inbox_message.receiver_sha256 == my_pubkey_sha256) continue ;
                            // found a message in inbox with a receiver_sha256. Find corresponding outbox message
                            outbox_message = null ;
                            for (k=0; k<contact.outbox.length ; k++) {
                                if (!contact.outbox[k].sender_sha256) continue ;
                                if (!contact.outbox[k].zeronet_msg_id) continue ;
                                if (contact.outbox[k].sender_sha256 != inbox_message.receiver_sha256) continue ;
                                outbox_message = contact.outbox[k] ;
                                break ;
                            } // for k (outbox)
                            // todo: add a special array with sender_sha256 addresses for deleted outbox messages?
                            if (!outbox_message) {
                                console.log(pgm + 'System error. Could not find any outbox messages with sender_sha256 = ' + inbox_message.sender_sha256);
                                continue ;
                            }
                            // outbox_message.sender_sha256 == inbox_message.receiver_sha256
                            // check if outbox_message is in data.msg array
                            zeronet_message = null ;
                            for (k=data.msg.length-1 ; k >= 0 ; k--) {
                                if (data.msg[k].message_sha256 != outbox_message.zeronet_msg_id) continue ;
                                // found a message that could be deleted from ZeroNet
                                zeronet_message = data.msg[k] ;
                                data.msg.splice(k,1);
                                delete outbox_message.zeronet_msg_id ;
                                local_storage_updated = true ;
                                break ;
                            }
                            if (!zeronet_message) continue ;
                            // break loops. removed a message from data.msg
                            console.log(pgm + 'data.json is big. removed outbox message received by contact') ;
                            break ;
                        } // for j (inbox)
                        if (zeronet_message) break ;
                    } // for i (contacts)
                    if (zeronet_message) continue ;

                    // c) delete old msg
                    if ((data.msg.length == 0) || (data.msg[0].timestamp > one_hour_ago)) {
                        console.log(pgm + 'no more old data to remove');
                        break ;
                    }
                    // remove old message and recheck
                    data.msg.splice(0,1);
                    console.log(pgm + 'data.json is big. deleted old message') ;
                } // while true

                // console.log(pgm + 'localStorage.messages (3) = ' + JSON.stringify(local_storage_messages));
                // console.log(pgm + 'ZeroNet data.msg (3) = ' + JSON.stringify(data.msg));

                if (local_storage_updated) {
                    // console.log(pgm + 'contacts updated. Save contacts in local storage');
                    MoneyNetworkHelper.setItem('contacts', JSON.stringify(local_storage_contracts)) ;
                    $timeout(function () {
                        MoneyNetworkHelper.local_storage_save() ;
                    })
                }

                // console.log(pgm + 'added new rows for user_seq ' + user_seq + ', data = ' + JSON.stringify(data)) ;
                // console.log(pgm + 'calling fileWrite: inner_path = ' + data_inner_path + ', data = ' + JSON.stringify(btoa(json_raw)));
                ZeroFrame.cmd("fileWrite", [data_inner_path, btoa(json_raw)], function (res) {
                    delete zeronet_file_locked[data_inner_path] ;
                    var pgm = service + '.zeronet_update_user_info fileWrite callback: ' ;
                    // console.log(pgm + 'res = ' + JSON.stringify(res)) ;
                    if (res === "ok") {
                        // console.log(pgm + 'calling sitePublish: inner_path = ' + content_inner_path) ;
                        ZeroFrame.cmd("sitePublish", {inner_path: content_inner_path}, function (res) {
                            var pgm = service + '.zeronet_update_user_info sitePublish callback: ' ;
                            // console.log(pgm + 'res = ' + JSON.stringify(res)) ;
                            if (res != "ok") {
                                ZeroFrame.cmd("wrapperNotification", ["error", "Failed to publish: " + res.error, 5000]);
                                console.log(pgm + 'Error. Failed to publish: ' + res.error);
                                console.log(pgm + 'todo: keep track of failed sitePublish. Could be device temporary offline');
                            }
                        }); // sitePublish
                    }
                    else {
                        ZeroFrame.cmd("wrapperNotification", ["error", "Failed to post: " + res.error, 5000]);
                        console.log(pgm + 'Error. Failed to post: ' + res.error) ;
                    }

                }); // fileWrite
            }); // fileGet
        } // zeronet_update_user_info


        // user info. Array with tag, value and privacy.
        // saved in localStorage. Shared with contacts depending on privacy choice
        var user_info = [] ;
        function empty_user_info_line() {
            return { tag: '', value: '', privacy: ''} ;
        }
        function load_user_info () {
            var pgm = service + '.load_user_info: ';
            // load user info from local storage
            var user_info_str, new_user_info ;
            user_info_str = MoneyNetworkHelper.getItem('user_info') ;
            // console.log(pgm + 'user_info loaded from localStorage: ' + user_info_str) ;
            // console.log(pgm + 'user_info_str = ' + user_info_str) ;
            if (user_info_str) new_user_info = JSON.parse(user_info_str) ;
            else new_user_info = [empty_user_info_line()] ;
            user_info.splice(0,user_info.length) ;
            for (var i=0 ; i<new_user_info.length ; i++) user_info.push(new_user_info[i]) ;
            // load user info from ZeroNet
            // compare
            console.log(pgm + 'todo: user info loaded from localStorage. must compare with user_info stored in data.json') ;
        }
        function get_user_info () {
            return user_info ;
        }
        function save_user_info () {
            var pgm = service + '.save_user_info: ';
            MoneyNetworkHelper.setItem('user_info', JSON.stringify(user_info)) ;
            $timeout(function () {
                MoneyNetworkHelper.local_storage_save() ;
                console.log(pgm + 'zeronet_update_user_info + zeronet_contact_search not working 100% correct. There goes a few seconds between updating data.json with new search words and updating the sqlite database');
                zeronet_update_user_info(pgm) ;
                MoneyNetworkHelper.zeronet_contact_search(local_storage_contracts, function () {$rootScope.$apply()}) ;
            })
        }

        // privacy options for user info - descriptions in privacyTitleFilter
        var privacy_options = ['Search', 'Public', 'Unverified', 'Verified', 'Hidden'] ;
        function get_privacy_options () {
            return privacy_options ;
        }
        var show_privacy_title = false ;
        function get_show_privacy_title() {
            return show_privacy_title ;
        }
        function set_show_privacy_title (show) {
            show_privacy_title = show ;
        }


        var local_storage_contracts = [] ;
        // get contacts stored in localStorage
        function local_storage_load_contacts () {
            var pgm = service + '.local_storage_load_contacts: ', contacts_str, new_contacts, new_contact ;
            contacts_str = MoneyNetworkHelper.getItem('contacts') ;
            if (contacts_str) new_contacts = JSON.parse(contacts_str);
            else new_contacts = [] ;
            local_storage_contracts.splice(0, local_storage_contracts.length) ;
            for (var i=0 ; i<new_contacts.length ; i++) {
                new_contact = new_contacts[i] ;
                if (!new_contact.inbox)  new_contact.inbox = [] ;
                if (!new_contact.outbox) new_contact.outbox = [] ;
                local_storage_contracts.push(new_contact) ;
            }
            // console.log(service + ': contacts loaded from localStorage: ' + JSON.stringify(local_storage_contracts));
        }
        function local_storage_get_contacts() {
            return local_storage_contracts ;
        }
        function local_storage_save_contacts (update_zeronet) {
            var pgm = service + '.local_storage_save_contacts: ' ;
            MoneyNetworkHelper.setItem('contacts', JSON.stringify(local_storage_contracts)) ;
            if (update_zeronet) {
                // update localStorage and zeronet
                $timeout(function () {
                    MoneyNetworkHelper.local_storage_save() ;
                    zeronet_update_user_info(pgm) ;
                })
            }
            else {
                // update only localStorage
                $timeout(function () {
                    MoneyNetworkHelper.local_storage_save() ;
                })
            }
        } // local_storage_save_contacts

        // load, get and save messages stored in localStorage
        // todo: move messages from "messages" to "contacts" and delete "messages" array
        function local_storage_move_messages () {
            var pgm = service + '.local_storage_move_messages: ', messages_str, new_messages, i, new_message ;
            var contact_id, j, contact ;
            messages_str = MoneyNetworkHelper.getItem('messages') ;
            if (!messages_str) return ; // OK - messages already moved to contacts
            new_messages = JSON.parse(messages_str);
            // move messages to contacts
            for (i=0 ; i<local_storage_contracts.length ; i++) {
                contact = local_storage_contracts[i] ;
                if (!contact.inbox) contact.index = [] ;
                if (!contact.outbox) contact.outbox = [] ;
            }
            for (i=0 ; i<new_messages.length ; i++) {
                new_message = new_messages[i] ;
                contact_id = new_message.contact_id ;
                contact = null ;
                for (j=0 ; j<local_storage_contracts.length ; j++) {
                    if (local_storage_contracts[j].contact_id == contact_id) contact = local_storage_contracts[j] ;
                } // for j
                if (!contact) console.log(pgm + 'Ignore message. Could not find any contact with id ' + contact_id + ', message = ' + JSON.stringify(new_message)) ;
                else {
                    delete new_message.contact_id ;
                    contact.outbox.push(new_message) ;
                }
            } // for i
            MoneyNetworkHelper.removeItem('messages') ;
            MoneyNetworkHelper.setItem('contacts', JSON.stringify(local_storage_contracts)) ;
            MoneyNetworkHelper.local_storage_save() ;
        } // local_storage_move_messages


        function next_local_msg_seq () {
            // next local msg seq
            var local_msg_seq = MoneyNetworkHelper.getItem('msg_seq');
            if (local_msg_seq) local_msg_seq = JSON.parse(local_msg_seq) ;
            else local_msg_seq = 0 ;
            local_msg_seq++ ;
            // no local_storage_save. next_local_msg_seq must be part of a contact update operation - ingoing or outgoing messages
            MoneyNetworkHelper.setItem('msg_seq', JSON.stringify(local_msg_seq)) ;
            return local_msg_seq ;
        } // next_local_msg_seq


        // after login - check for new ingoing messages (dbQuery)
        var inbox_watch_sender_sha256 = [] ; // listen for sha256 addresses
        var inbox_ignore_zeronet_msg_id = [] ; // ignore already read messages
        function local_storage_read_messages () {
            var pgm = service + '.local_storage_read_messages: ' ;

            // initialize watch_sender_sha256 array with relevant sender_sha256 addresses
            // that is sha256(pubkey) + any secret sender_sha256 reply addresses sent to contacts in money network
            var my_pubkey, my_pubkey_sha256, my_prvkey, i, j, contact, message ;
            my_pubkey = MoneyNetworkHelper.getItem('pubkey') ;
            my_pubkey_sha256 = CryptoJS.SHA256(my_pubkey).toString();
            my_prvkey = MoneyNetworkHelper.getItem('prvkey') ;

            inbox_watch_sender_sha256.splice(0, inbox_watch_sender_sha256.length);
            inbox_watch_sender_sha256.push(my_pubkey_sha256);
            for (i=0 ; i<local_storage_contracts.length ; i++) {
                contact = local_storage_contracts[i] ;
                // ignore already read messages
                if (!contact.inbox) contact.inbox = [] ;
                for (j=0 ; j<contact.inbox.length ; j++) {
                    message = contact.inbox[j] ;
                    if (message.zeronet_msg_id) inbox_ignore_zeronet_msg_id.push(message.zeronet_msg_id) ;
                } // j (inbox)
                if (!contact.outbox) contact.outbox = [] ;
                // check sender_sha256 addresses send to other contacts
                for (j=0 ; j<contact.outbox.length ; j++) {
                    message = contact.outbox[j] ;
                    if (message.sender_sha256) {
                        if (inbox_watch_sender_sha256.indexOf(message.sender_sha256) == -1) inbox_watch_sender_sha256.push(message.sender_sha256);
                    }
                } // j (outbox)
            } // i (contacts)

            // console.log(pgm + 'inbox_watch_sender_sha256 = ' + JSON.stringify(inbox_watch_sender_sha256)) ;
            // console.log(pgm + 'inbox_ignore_zeronet_msg_id = ' + JSON.stringify(inbox_ignore_zeronet_msg_id)) ;
            // fetch relevant messages
            var query =
                "select" +
                "  messages.user_seq, messages.receiver_sha256, messages.key, messages.message," +
                "  messages.message_sha256, messages.timestamp, messages.json_id, " +
                "  users.pubkey, substr(json.directory,7) auth_address " +
                "from messages, users, json " +
                "where ( messages.receiver_sha256 in ('" + inbox_watch_sender_sha256[0] + "'" ;
            for (i=1 ; i<inbox_watch_sender_sha256.length ; i++) query = query + ", '" + inbox_watch_sender_sha256[i] + "'" ;
            query = query + ')' ;
            if (inbox_ignore_zeronet_msg_id.length > 0) {
                query = query + " or messages.message_sha256 in ('" + inbox_ignore_zeronet_msg_id[0] + "'" ;
                for (i=1 ; i<inbox_ignore_zeronet_msg_id.length ; i++) query = query + ", '" + inbox_ignore_zeronet_msg_id[i] + "'" ;
                query = query + ')' ;
            }
            query = query + " )" +
                "and users.json_id = messages.json_id " +
                "and users.user_seq = messages.user_seq " +
                "and json.json_id = messages.json_id" ;
            // console.log(pgm + 'query = ' + query) ;

            ZeroFrame.cmd("dbQuery", [query], function(res) {
                var pgm = service + '.local_storage_read_messages dbQuery callback: ';
                // console.log(pgm + 'res = ' + JSON.stringify(res));
                //res = [{
                //    "timestamp": 1476103057083,
                //    "auth_address": "1Hzh7qdPPQQndim5cq9UpdKeBJxqzQBYx4",
                //    "receiver_sha256": "e7fcc820791e7c9575f92b4d891760638287a40a17f67ef3f4a56e86b7d7756b",
                //    "key": "fvljzIjj2SvFtAYsVzyAILodSvbmeGxtXmn3T0k7YZXJ2CPqJQkkzFop5Ivwb0rbnbL1pYnI3XVxAKXOIsytuzzynxtF464fhCypw2StmUl2NzwDUh8du8UW9QeXuJDoidcnvlAwN0J5n0lOTTviVkGxUCVj4Kwds27qKpDIhhsFbX975VkQbtbmkGIxgMZ3bA10B9W+YuBB/XpyyHXUtaPfYFW8ByDAaMeQLM43cukEXkyOiOCrzbTwYrKiqrMLkv3InbuHEYHY3NPA0xtL1YTE5nGsOsQKMFujmn/fI4CGG9ylcxB/IsCx+nbQhQm+TC+VGpcXgtdrVcz0JJqPUg==",
                //    "json_id": 24,
                //    "user_seq": 1,
                //    "message": "U2FsdGVkX19oqJz2RoyOoyG73i2nVyRrXIiw7xyJZVn5XL7hVYhr5O3dh5VApOZrM5MJNSAVLEd9yUqCyrTaHQxg8LZrwOxrRAeQHl+cIzQX7Q+/kyPTAjs6CBCk8EWbUzfcZcfmACeh4KlddFCsVLaG/mpMib/J+UIgAvIBroIj7zCQCapzmNOwUQODbW5B",
                //    "message_sha256": "c35761731a4b5286c758772d3bc3bc2ecd7f49041a312fad05df015a9004e804",
                //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjVluDxwL7zcL16AaeLcW\nHWIMcMra0Al/7TNnJqtoRNoJJXc+RPV7r0YKyNHY5d9k31gNxYWNA4aLqrc4cevN\namnk6qIKqK0HHT8kXIkxn7qm62/zn1uu4PQhWqab38GT70PaICC0XBJ+vHGiaxcZ\n5njwm3HMxcKigCUheHS7Qpg61mbs4LPfdXKdOw1zUI3mKNSfJmDu6gxtpbQzC0hJ\ncTym7V6RRUWCQJsLWNHcesVZLZbeECAjzRWZR62A1PDnJsuB8vYt5GV5pgrIDAYx\n1cD961mgOghkD2OZMdhp9RyWQ0mMxYqG7Gyp/HCnase8ND8+9GsQtS1YBM+FBN8E\nwQIDAQAB\n-----END PUBLIC KEY-----"
                //}];
                if (res.error) {
                    ZeroFrame.cmd("wrapperNotification", ["error", "Search for new messages failed: " + res.error, 5000]);
                    console.log(pgm + "Search for new messages failed: " + res.error);
                    console.log(pgm + 'query = ' + query);
                    return;
                }

                // check inbox_ignore_zeronet_msg_id array. has previously received messages been deleted on ZeroNet?
                var inbox_ignore_zeronet_msg_id_clone = inbox_ignore_zeronet_msg_id.slice() ;
                var contacts_updated = false ;
                var i, j, contact, k, inbox_message, decrypted_message ;
                for (i=res.length-1 ; i>= 0 ; i--) {
                    j = inbox_ignore_zeronet_msg_id_clone.indexOf(res[i].message_sha256) ;
                    if (j != -1) {
                        // previous received message is still on ZeroNet
                        inbox_ignore_zeronet_msg_id_clone.splice(j,1) ;
                        res.splice(i);
                    }
                } // for i (res)
                if (inbox_ignore_zeronet_msg_id_clone.length > 0) {
                    console.log(pgm + 'messages deleted on Zeronet: ' + JSON.stringify(inbox_ignore_zeronet_msg_id_clone));
                    for (i=0 ; i<local_storage_contracts.length ; i++) {
                        contact = local_storage_contracts[i] ;
                        for (j=0 ; j<contact.inbox.length ; j++) {
                            inbox_message = contact.inbox[j] ;
                            k = inbox_ignore_zeronet_msg_id_clone.indexOf(inbox_message.zeronet_msg_id) ;
                            if (k != -1) {
                                // previously received message has been deleted on ZeroNet
                                inbox_ignore_zeronet_msg_id_clone.splice(k,1);
                                delete inbox_message.zeronet_msg_id ;
                                contacts_updated = true ;
                            }
                        } // for j (inbox)
                    } // for i (contacts)
                } // if
                if (inbox_ignore_zeronet_msg_id_clone.length > 0) {
                    console.log(pgm + 'System error. inbox_ignore_zeronet_msg_id_clone should be empty now');
                    console.log(pgm + 'inbox_ignore_zeronet_msg_id_clone.length = ' + JSON.stringify(inbox_ignore_zeronet_msg_id_clone.length));
                }
                if (res.length == 0) {
                    console.log(pgm + 'no new messages') ;
                    if (contacts_updated) local_storage_save_contacts(false) ;
                    return ;
                }

                var unique_id, contact, encrypt, password, decrypted_message_str, local_msg_seq, sender_sha256 ;
                // console.log(pgm + 'debug: contacts = ' + JSON.stringify(local_storage_contracts));
                for (i=res.length-1 ; i>=0 ; i--) {
                    unique_id = CryptoJS.SHA256(res[i].auth_address + '/'  + res[i].pubkey).toString();
                    contact = null ;
                    // console.log(pgm + 'debug: res[' + i + '] = ' + JSON.stringify(res[i]));
                    // console.log(pgm + 'debug: unique_id = ' + unique_id);
                    for (j=0 ; j<local_storage_contracts.length ; j++) {
                        if (local_storage_contracts[j].unique_id == unique_id) contact = local_storage_contracts[j] ;
                    }
                    // todo: search for contacts are not working 100% correct ....
                    if (!contact) console.log(pgm + 'todo: contact with unique id ' + unique_id + ' was not found. should be created. must be an add contact message');
                    else console.log(pgm + 'contact = ' + JSON.stringify(contact));

                    // decrypt message and insert into contacts inbox
                    if (!encrypt) {
                        encrypt = new JSEncrypt();
                        encrypt.setPrivateKey(my_prvkey);
                    }
                    try {
                        password = encrypt.decrypt(res[i].key);
                        decrypted_message_str = MoneyNetworkHelper.decrypt(res[i].message, password)
                    }
                    catch (err) {
                        console.log(pgm + 'Ignoring message with invalid encryption. error = ' + err.message) ;
                        continue ;
                    }
                    console.log(pgm + 'decrypted message = ' + decrypted_message_str) ;
                    decrypted_message = JSON.parse(decrypted_message_str);

                    //res[i] = {
                    //    "timestamp": 1476117972048,
                    //    "auth_address": "1Evtb7WU1RzzzHHoYuj4ELxx1TnyRbPcXT",
                    //    "receiver_sha256": "e7fcc820791e7c9575f92b4d891760638287a40a17f67ef3f4a56e86b7d7756b",
                    //    "key": "wJqsuUCPX0E9VsLcbUqVMP6Q+aV2o6g+YMOL4eK3p61MegyPTvkpbikhmd0EkRAfFiziG0P2b3K41t9OlRmi0FgyP7tTWFQJhu7rsEZVPmW71jAAZwAD2pz5li/QR8vatPg5fkOMOuD/UHF8oAvzyMX3NvqeOKxUCHu/QR02Gzgw3VKycJ96vjryi26iR4CCLYC1gRrOC/JUzLrEWSqoP7KEiFvDEQDA9gqplknA1Plrj6iUTIAJy9ZdQsQdT2ZlgKpDOlieFoAW9I/V89Udo7TgmfrK36RA2V6kemfzYJf38eZaTVEaK6RvNBNoPLI3bsUr2Knk+mlKktp5rUzF5A==",
                    //    "json_id": 44,
                    //    "user_seq": 1,
                    //    "message": "U2FsdGVkX1+JdSxbsXuXUBpGFZx2UXosl0Hl8X4Fmb9eqSVXWN76gbbW7Az1ibeYL8YfVjISCKXMbM8nmJu47t2TDFmrQx/m2eDijyIzFumk4m+yCMTeVlFA4PlYHL2Ra8F1WgX8crpZ22nUY7gReAqumoPh/FUGBgGj5pbQcWLg1vYC+xgGB5gs3aDVROiZ",
                    //    "message_sha256": "8f5d165b1e79978aa32d9a2ede1b43c913388bd5b1bfc1623774afe410926cf8",
                    //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQB3gMMKzwZx3dpb8n0KONcF\nK5tFFOYSh/Ip8SLzcoGr3LtWjygR6bX95/Kh9QlbrD2/uNQRCA4duITiwcmvZcn8\nEUXwWXw1z0CMiPjF6ell9SygUJwkJAHHHwX4JJEE1W5mmTnUM19K95SlEwW7WhF3\nYuQH3sADRcQ7hgoJ9/Zgxk4oUv9mwnRhOuAZj0jSMKiRB5+fFP5tJlAR4Nm5366f\nsrccbg8FoFvZgcgovtr5cx8MtUsGFMqbkGtQNlLA0Uqie0Va7FsoV6SD3w79YyB8\n6o5/lM1MgLptLLEy8i7lDUeiem1yVOY5DHr2L17BJ/Yj9+smW1jD5N1HLtsmJ+xX\nAgMBAAE=\n-----END PUBLIC KEY-----"
                    //}
                    // outbox example:
                    // local_storage_messages[3] = {
                    //    "local_msg_seq": 15,
                    //    "message": {"msg": "contact added", "search": []},
                    //    "sender_sha256": "252b735ca19123f4ace146e706ef06dca3a13c8414e7ffe61dc393d719c036f4",
                    //    "zeronet_msg_id": "b6baac49e244324ce1bfba7cb9d3601c0fcbcd9a816a3dfd31c5cce1087f70b8",
                    //    "send_at": 1476005958406
                    //};
                    if (!contact) continue ;

                    // validate incoming message.
                    sender_sha256 = null ;
                    if (!decrypted_message.msgtype) {
                        console.log(pgm + 'Ignoring message without required msgtype');
                        decrypted_message = {
                            msgtype: 'invalid',
                            error: 'message without msgtype',
                            message: decrypted_message
                        };
                    }
                    else {
                        // validate json based on decrypted_message.msgtype
                        var error = MoneyNetworkHelper.validate_json (pgm, decrypted_message, decrypted_message.msgtype, 'Ignoring invalid message') ;
                        if (error) {
                            decrypted_message = {
                                msgtype: 'invalid',
                                error: error,
                                message: decrypted_message
                            };
                        }
                        else {
                            // incoming message is valid.
                            // any secret reply to sha256 address on message?
                            sender_sha256 = decrypted_message.sender_sha256 ;
                            delete decrypted_message.sender_sha256 ;
                            console.log(pgm + 'sender_sha256 = ' + sender_sha256);
                        }
                    }

                    // save message
                    local_msg_seq = next_local_msg_seq() ;
                    inbox_message = {
                        local_msg_seq: local_msg_seq,
                        message: decrypted_message,
                        zeronet_msg_id: res[i].message_sha256,
                        sender_sha256: sender_sha256,
                        sent_at: res[i].timestamp,
                        receiver_sha256: res[i].receiver_sha256,
                        received_at: new Date().getTime()} ;
                    if (!sender_sha256) delete inbox_message.sender_sha256 ;
                    if (inbox_message.receiver_sha256 == my_pubkey_sha256) delete inbox_message.receiver_sha256 ;
                    console.log(pgm + 'new inbox message = ' + JSON.stringify(inbox_message));
                    contact.inbox.push(inbox_message) ;
                    res.splice(i,1) ;
                    contacts_updated = true ;

                    // post processing new incoming messages
                    if (decrypted_message.msgtype == 'contact added') {
                        // add search words to contact
                        for (j=0 ; j<decrypted_message.search.length ; j++) {
                            contact.search.push({
                                tag: decrypted_message.search[j].tag,
                                value: decrypted_message.search[j].value,
                                privacy: decrypted_message.search[j].privacy
                            }) ;
                        }
                    }

                    // todo:

                } // for i (res)

                if (contacts_updated) local_storage_save_contacts(false) ;

            });

        } // local_storage_read_messages


        // add message to contact
        // params:
        //   contact - from contacts array
        //   message - json - should include a secret sender_sha256 for reply
        //   sender_sha256:
        //     true  - add random sender_sha256 address to message (default)
        //     false - add no sender_sha256 address to message
        //   receiver_sha256: null: use pubkey. otherwise a secret received sha256 address
        function add_msg(contact, message, sender_sha256, receiver_sha256) {
            var pgm = service + '.add_message: ' ;
            // check params - add default values
            if ((typeof sender_sha256 == 'undefined') || (sender_sha256 == null)) sender_sha256 = true ;
            else if (sender_sha256) sender_sha256=true ;
            else sender_sha256=false ;
            if (!receiver_sha256) receiver_sha256 = CryptoJS.SHA256(contact.pubkey).toString();
            // next local msg seq
            var local_msg_seq = next_local_msg_seq() ;
            // save message in localStorage. local_storage_save_messages / zeronet_update_user_info call will encrypt and add encrypted message to data.json (ZeroNet)
            if (!contact.outbox) contact.outbox = [] ;
            contact.outbox.push({
                local_msg_seq: local_msg_seq, // sequence
                receiver_sha256: receiver_sha256, // receiver of outgoing msg - normally a random sha256 address received from contact
                pubkey: contact.pubkey, // rsa encrypt with contact public key
                message: message, // unencrypted message
                sender_sha256: sender_sha256 // boolean: true - add random sha256 return address
            }) ;
            // return local msg seq for any cancel/delete message operations
            return local_msg_seq ;
        } // add_msg

        // delete previously send message. returns true if ZeroNet must be updated after calling the method
        function remove_msg (local_msg_seq) {
            var pgm = service + '.remove_msg: ' ;
            var msg, zeronet_update, i, contact, j;
            // console.log(pgm + 'local_msg_seq = ' + local_msg_seq);
            zeronet_update = false ;
            for (i=0; i<local_storage_contracts.length ; i++) {
                contact = local_storage_contracts[i] ;
                if (!contact.outbox) contact.outbox = [] ;
                for (j=contact.outbox.length-1 ; j >= 0 ; j--){
                    msg = contact.outbox[j] ;
                    if (msg.local_msg_seq == local_msg_seq) {
                        if (msg.zeronet_msg_id) {
                            // already on ZeroNet. Delete mark message. Will be processed in next zeronet_update_user_info call
                            msg.deleted_at = new Date().getTime() ;
                            zeronet_update = true ;
                        }
                        else contact.outbox.splice(j,1) ;
                    }
                }
            }
            return zeronet_update ;
        } // remove_msg

        // wait for setSiteInfo events
        function event_file_done (event, filename) {
            var pgm = service + '.event_file_done: ' ;
            if (event != 'file_done') return ;
            console.log(pgm + 'filename = ' + filename) ;
            // a) check new incoming messages
        }
        ZeroFrame.bind_event(event_file_done);

        // export MoneyNetworkService API
        return {
            get_tags: get_tags,
            get_privacy_options: get_privacy_options,
            get_show_privacy_title: get_show_privacy_title,
            set_show_privacy_title: set_show_privacy_title,
            empty_user_info_line: empty_user_info_line,
            load_user_info: load_user_info,
            get_user_info: get_user_info,
            save_user_info: save_user_info,
            local_storage_load_contacts: local_storage_load_contacts,
            local_storage_get_contacts: local_storage_get_contacts,
            local_storage_save_contacts: local_storage_save_contacts,
            local_storage_move_messages: local_storage_move_messages,
            local_storage_read_messages: local_storage_read_messages,
            add_msg: add_msg,
            remove_msg: remove_msg
        };
        // end MoneyNetworkService
    }])


    .controller('NavCtrl', [function () {
        var self = this;
        var controller = 'NavCtrl';
        console.log(controller + ' loaded');
        self.texts = {appname: 'Money Network'};

    }])


    .controller('AuthCtrl', ['$location', 'MoneyNetworkService', function ($location, moneyNetworkService) {
        var self = this;
        var controller = 'AuthCtrl';
        console.log(controller + ' loaded');

        self.is_logged_in = function () {
            return MoneyNetworkHelper.getUserId();
        };
        self.register = 'N' ;
        function set_register_yn() {
            var pgm = controller + '.login_or_register: ' ;
            var passwords, no_users ;
            passwords = MoneyNetworkHelper.getItem('passwords') ;
            if (!passwords) no_users = 0 ;
            else no_users = JSON.parse(passwords).length ;
            self.register = (no_users == 0) ? 'Y' : 'N';
        }
        MoneyNetworkHelper.local_storage_bind(set_register_yn) ;

        self.login_disabled = function () {
            if (self.register != 'N') return true;
            if (!self.device_password) return true;
            if (self.device_password.length < 10) return true;
            if (self.device_password.length > 50) return true;
            return false;
        };
        self.register_disabled = function () {
            if (self.register != 'Y') return true;
            if (!self.device_password) return true;
            if (self.device_password.length < 10) return true;
            if (self.device_password.length > 50) return true;
            if (!self.confirm_device_password) return true;
            return (self.device_password != self.confirm_device_password);
        };
        self.login_or_register = function () {
            var pgm = controller + '.login_or_register: ';
            self.login_or_register_error = '';
            var create_new_account = (self.register == 'Y');
            var userid = MoneyNetworkHelper.client_login(self.device_password, create_new_account);
            if (userid == 0) {
                var error = 'Invalid password' ;
                self.login_or_register_error = error;
                ZeroFrame.cmd("wrapperNotification", ['error', error, 3000]);
            }
            else {
                // clear login form
                ZeroFrame.cmd("wrapperNotification", ['done', 'Log in OK', 3000]);
                self.device_password = '';
                self.confirm_device_password = '';
                self.register = 'N';
                // load user information from localStorage
                moneyNetworkService.load_user_info() ;
                moneyNetworkService.local_storage_load_contacts() ;
                moneyNetworkService.local_storage_move_messages() ;
                moneyNetworkService.local_storage_read_messages() ;
                var user_info = moneyNetworkService.get_user_info() ;
                var empty_user_info_str = JSON.stringify([moneyNetworkService.empty_user_info_line()]) ;
                if (JSON.stringify(user_info) == empty_user_info_str) $location.path('/user');
                else $location.path('/home');
                $location.replace();
            }
        };

    }])


    .controller('ChatCtrl', ['MoneyNetworkService', '$scope', '$timeout', '$routeParams', '$location', function (moneyNetworkService, $scope, $timeout, $routeParams, $location) {
        var self = this;
        var controller = 'ChatCtrl';
        console.log(controller + ' loaded');

        self.contact = {} ;
        var contacts = moneyNetworkService.local_storage_get_contacts() ;
        function find_contact () {
            var unique_id = $routeParams.unique_id ;
            for (var i=0 ; i<contacts.length ; i++) {
                if (contacts[i].unique_id = unique_id) { self.contact = contacts[i]; return }
            }
            ZeroFrame.cmd("wrapperNotification", ['error', 'Chat not possible. unknown contact ID ' + unique_id, 5000]);
            $location.path('/home');
            $location.replace();
        }
        find_contact() ;
        console.log(controller + ': contact = ' + JSON.stringify(self.contact));
        //contact = {
        //    "unique_id": "d6922951a0321b926e7c65717c15a16283eb9db7a4b5a2062c9c83804e6dfb4e",
        //    "type": "unverified",
        //    "auth_address": "1HswdvGGQtgHT1xWaMzhkdQrjpnZECPSN1",
        //    "cert_user_id": "1HswdvGGQtgHT@moneynetwork",
        //    "pubkey": "-----BEGIN PUBLIC KEY-----\nMIIBITANBgkqhkiG9w0BAQEFAAOCAQ4AMIIBCQKCAQBbyWzd/9ePgFpk0VSId6fe\nChRM60XmcB2Rmxbps795LcXVn1rasYtCVqKfIviX6z9m+F8IwmfR2mTZ7b+qiddW\nYH0/WCCb8fEnA4hjuXwiULJY2PfXSxdKhaF5Jag4yyNgF99uCyUzezpIL4GQNU69\ntiVSyUwppnymL8YzoIImqLrHbuI/sH2VlNlHvZVbyl14tOkfbOHwVtuLcly+e/72\nZZfTnxnVCcVwBQdaqNNlZUnJmnVXGYvAW4+uBo4PQfJJqcK3AyR5S9xkZBX1F4KO\nzbH5O1VG5OpnJ7kdhEYqJjesglVAEzoQlSrhF98C8BrDU9afrjDek4ERMe0iOTpB\nAgMBAAE=\n-----END PUBLIC KEY-----",
        //    "search": [{
        //        "tag": "Last updated",
        //        "value": 1476207714.473779,
        //        "privacy": "Search",
        //        "row": 1,
        //        "$$hashKey": "object:569"
        //    }, {"tag": "Name", "value": "test1", "privacy": "Search", "row": 2, "$$hashKey": "object:570"}],
        //    "inbox": [{
        //        "local_msg_seq": 10,
        //        "message": {
        //            "msg": "contact added",
        //            "search": [],
        //            "sender_sha256": "a551a1cedb90a6debf09e316d485cab2b169ebb0b50682fe55c01919e910fbda"
        //        },
        //        "receiver_sha256": "e7fcc820791e7c9575f92b4d891760638287a40a17f67ef3f4a56e86b7d7756b",
        //        "sent_at": 1476174007579,
        //        "received_at": 1476179706311
        //    }],
        //    "outbox": [{
        //        "local_msg_seq": 47,
        //        "message": {
        //            "msgtype": "contact added",
        //            "search": [{"tag": "Name", "value": "test1 public xxxx", "privacy": "Public"}]
        //        },
        //        "sender_sha256": "9c4e7093bba371cd5f211cad5924d6f36fbfd62491acd729f3e9bf9b29740369",
        //        "zeronet_msg_id": "3cdf3a7d28211b79555566a0cd700ab6bb7b060e1a35843315dcd72aad54dda2",
        //        "send_at": 1476272524922
        //    }],
        //    "$$hashKey": "object:296",
        //    "add_contact_msg": 47
        //};

    }])


    .controller('ContactCtrl', ['MoneyNetworkService', '$scope', '$timeout', '$location', function (moneyNetworkService, $scope, $timeout, $location) {
        var self = this;
        var controller = 'ContactCtrl';
        console.log(controller + ' loaded');

        // get contracts. two different types of contacts:
        // a) contacts stored in localStorage
        self.contacts = moneyNetworkService.local_storage_get_contacts() ; // array with contacts from localStorage
        // b) search for new ZeroNet contacts using user info (Search and Hidden keywords)
        self.zeronet_search_contracts = function() {
            MoneyNetworkHelper.zeronet_contact_search(self.contacts, function () {$scope.$apply()}) ;
        };
        self.zeronet_search_contracts() ;

        // first column in contacts table. return user_id or type
        self.get_user_info = function (contact,search) {
            if (search.row == 1) {
                // return short cert_user_id or alias
                if (contact.alias) return '<b>' + contact.alias + '</b>';
                var i = contact.cert_user_id.indexOf('@') ;
                return '<b>' + contact.cert_user_id.substr(0,i) + '</b>';
            }
            if (search.row == 2) return '(' + contact.type + ')' ;
            return null ;
        };

        // edit alias functions
        self.edit_alias_title = "Edit alias. Press ENTER to save. Press ESC to cancel" ;
        var edit_alias_notifications = 1 ;
        self.edit_user_info = function (contact, search) {
            var pgm = controller + '.edit_user_info: ', i ;
            if (search.row != 1) return ;
            if (contact.alias) contact.new_alias = contact.alias ;
            else {
                i = contact.cert_user_id.indexOf('@') ;
                contact.new_alias = contact.cert_user_id.substr(0,i) ;
            }
            search.edit_alias = true ;
            if (edit_alias_notifications > 0) {
                ZeroFrame.cmd("wrapperNotification", ["info", self.edit_alias_title, 5000]);
                edit_alias_notifications-- ;
            }
            // set focus - in a timeout - wait for angularJS
            var id = contact.$$hashKey + ':alias' ;
            var set_focus = function () { document.getElementById(id).focus() } ;
            $timeout(set_focus) ;
        } ;
        self.cancel_edit_alias = function (contact, search) {
            var pgm = controller + '.cancel_edit_alias: ' ;
            delete contact.new_alias ;
            delete search.edit_alias ;
            $scope.$apply() ;
        } ;
        self.save_user_info = function (contact, search) {
            var pgm = controller + '.save_user_info: ';
            // update angular UI
            contact.alias = contact.new_alias ;
            delete search.edit_alias ;
            $scope.$apply() ;
            // save contacts in localStorage
            // console.log(pgm + 'calling local_storage_save_contacts') ;
            moneyNetworkService.local_storage_save_contacts(false) ;
        };

        // filter contacts. show contacts with green filter. hide contacts with red filter
        self.filters = {
            all: 'red',
            new: 'green',
            unverified: 'green',
            verified: 'green',
            ignore: 'red'
        } ;
        self.toogle_filter = function (filter) {
            var pgm = controller + '.toogle_filter: ' ;
            if (self.filters[filter] == 'green') self.filters[filter] = 'red' ;
            else self.filters[filter] = 'green' ;
            // special action for all
            if (filter == 'all') {
                if (self.filters['all'] == 'green') {
                    // all: red => green. set all filters to green
                    for (filter in self.filters) self.filters[filter] = 'green' ;
                }
                else {
                    // all: green => red. set all filters to red if all filters are green
                    if (self.filters.new == 'red') return ;
                    if (self.filters.unverified == 'red') return ;
                    if (self.filters.verified == 'red') return ;
                    if (self.filters.ignore == 'red') return ;
                    for (filter in self.filters) self.filters[filter] = 'red' ;
                }
            }
            else if ((self.filters[filter] == 'red') && (self.filters.all == 'green')) self.filters.all = 'red' ;
        };
        self.filter_contracts = function (value, index, array) {
            var pgm = controller + '.filter_contacts: ' ;
            return (self.filters[value.type] == 'green');
        };

        // contact actions: add, ignore, verify, remove, chat
        self.add_contact = function (contact) {
            var pgm = controller + '.add_contact: ' ;
            // console.log(pgm + 'click');
            // move contact to unverified contacts
            contact.type = 'unverified' ;
            // send contact info. to unverified contact (privacy public and unverified)
            // console.log(pgm + 'todo: send message add contact message to other contact including relevant tags') ;
            var message = {
                msgtype: 'contact added',
                search: []
            } ;
            console.log(pgm + 'message = ' + JSON.stringify(message));
            var user_info = moneyNetworkService.get_user_info() ;
            for (var i=0 ; i<user_info.length ; i++) {
                if (['Public','Unverified'].indexOf(user_info[i].privacy) == -1) continue ;
                message.search.push({tag: user_info[i].tag, value: user_info[i].value, privacy: user_info[i].privacy}) ;
            } // for i
            if (message.search.length == 0) {
                // no search words in "contact added" message. No message sent
                console.log(pgm + 'contact added message was not sent. No relevant user info tags found');
                contact.add_contact_msg = null ;
                moneyNetworkService.local_storage_save_contacts(false);
                return ;
            }
            // validate json
            var error = MoneyNetworkHelper.validate_json (pgm, message, message.msgtype, 'Contact added but no additional user info send to contact') ;
            if (error) {
                moneyNetworkService.local_storage_save_contacts(false);
                ZeroFrame.cmd("wrapperNotification", ["Error", error]);
                return ;
            }
            // send message
            contact.add_contact_msg = moneyNetworkService.add_msg(contact, message, true, null) ;
            // update localStorage and ZeroNet
            // console.log(pgm + 'calling local_storage_save_contacts');
            moneyNetworkService.local_storage_save_contacts(true) ;
        }; // add_contact
        self.ignore_contact = function (contact) {
            var pgm = controller + '.ignore_contact: ' ;
            var i, contact2 ;
            for (i=0 ; i<self.contacts.length ; i++) {
                contact2 = self.contacts[i] ;
                if ((contact2.type == 'new')&&
                    ((contact2.cert_user_id == contact.cert_user_id) || (contact2.pubkey == contact.pubkey) )) contact2.type = 'ignore' ;
            }
            moneyNetworkService.local_storage_save_contacts(false);
        }; // unignore new contact
        self.unplonk_contact = function (contact) {
            contact.type = 'new' ;
            moneyNetworkService.local_storage_save_contacts(false);
        };
        self.verify_contact = function (contact) {
            ZeroFrame.cmd("wrapperNotification", ["info", "Verify contact not yet implemented", 3000]);
        };
        self.chat_contact = function (contact) {
            // ZeroFrame.cmd("wrapperNotification", ["info", "Chat with contact not yet implemented", 3000]);
            $location.path('/chat/' + contact.unique_id);
            $location.replace();
        };
        self.remove_contact = function (contact) {
            var pgm = controller + '.remove_contact: ' ;
            var zeronet_updated ;
            contact.type = 'new' ;
            // cancel/delete previous "contact added" message. add add_contact
            if (!contact.add_contact_msg) {
                console.log(pgm + 'no contact added message to delete. No relevant user info tags were send when adding contact');
                moneyNetworkService.local_storage_save_contacts(false);
                return ;
            }
            zeronet_updated = moneyNetworkService.remove_msg(contact.add_contact_msg) ;
            // console.log(pgm + 'zeronet_update = ' + zeronet_update);
            delete contact.add_contact_msg ;
            // console.log(pgm + 'calling local_storage_save_contacts') ;
            moneyNetworkService.local_storage_save_contacts(zeronet_updated) ;
        };

    }])


    .controller('UserCtrl', ['$scope', 'MoneyNetworkService', function($scope, moneyNetworkService) {
        var self = this;
        var controller = 'UserCtrl';
        console.log(controller + ' loaded');

        self.user_info = moneyNetworkService.get_user_info() ; // array with tags and values from localStorage
        self.tags = moneyNetworkService.get_tags() ; // typeahead autocomplete functionality
        self.privacy_options = moneyNetworkService.get_privacy_options() ; // select options with privacy settings for user info
        self.show_privacy_title = moneyNetworkService.get_show_privacy_title() ; // checkbox - display column with privacy descriptions?

        // add empty rows to user info table. triggered in privacy field. enter and tab (only for last row)
        self.insert_row = function(row) {
            var pgm = controller + '.insert_row: ' ;
            var index ;
            for (var i=0 ; i<self.user_info.length ; i++) if (self.user_info[i].$$hashKey == row.$$hashKey) index = i ;
            index = index + 1 ;
            self.user_info.splice(index, 0, moneyNetworkService.empty_user_info_line());
            $scope.$apply();
        };
        self.delete_row = function(row) {
            var pgm = controller + '.delete_row: ' ;
            var index ;
            for (var i=0 ; i<self.user_info.length ; i++) if (self.user_info[i].$$hashKey == row.$$hashKey) index = i ;
            // console.log(pgm + 'row = ' + JSON.stringify(row)) ;
            self.user_info.splice(index, 1);
            if (self.user_info.length == 0) self.user_info.splice(index, 0, moneyNetworkService.empty_user_info_line());
        };

        // user_info validations
        self.is_tag_required = function(row) {
            if (row.value) return true ;
            if (row.privary) return true ;
            return false ;
        };
        self.is_value_required = function(row) {
            if (!row.tag) return false ;
            if (row.tag == 'GPS') return false ;
            return true ;
        };
        self.is_privacy_required = function(row) {
            if (row.tag) return true ;
            if (row.value) return true ;
            return false ;
        };

        self.show_privacy_title_changed = function () {
            moneyNetworkService.set_show_privacy_title(self.show_privacy_title)
        };

        self.update_user_info = function () {
            var pgm = controller + '.update_user_info: ' ;
            // console.log(pgm + 'calling moneyNetworkService.save_user_info()');
            moneyNetworkService.save_user_info() ;
            // console.log(pgm) ;
        };
        self.revert_user_info = function () {
            var pgm = controller + '.revert_user_info: ' ;
            moneyNetworkService.load_user_info() ;
            // console.log(pgm) ;
        };

    }])


    // catch key enter event in user info table (insert new empty row in table)
    // also cacthing on key tab event for last row in table (insert row empty row at end of table)
    // used for UserCtl.insert_row
    // http://stackoverflow.com/questions/17470790/how-to-use-a-keypress-event-in-angularjs
    // https://gist.github.com/singhmohancs/317854a859098bffe9477f59eac8d915
    .directive('onKeyEnter', ['$parse', function($parse) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                element.bind('keydown keypress', function(event) {
                    // console.log('onKeyEnter: event.which = ' + event.which) ;
                    if ((event.which === 13) || ((event.which === 9) && scope.$last)) {
                        var attrValue = $parse(attrs.onKeyEnter);
                        (typeof attrValue === 'function') ? attrValue(scope) : angular.noop();
                        event.preventDefault();
                    }
                });
                scope.$on('$destroy', function() {
                    element.unbind('keydown keypress')
                })
            }
        };
    }])


    .directive('onKeyEscape', ['$parse', function($parse) {
        return {
            restrict: 'A',
            link: function(scope, element, attrs) {
                element.bind('keydown keypress', function(event) {
                    // console.log('onKeyEscape: event.which = ' + event.which) ;
                    if (event.which === 27) {
                        var attrValue = $parse(attrs.onKeyEscape);
                        (typeof attrValue === 'function') ? attrValue(scope) : angular.noop();
                        event.preventDefault();
                    }
                });
                scope.$on('$destroy', function() {
                    element.unbind('keydown keypress')
                })
            }
        };
    }])


    .filter('toJSON', [function () {
        // debug: return object as a JSON string
        return function (object) {
            return JSON.stringify(object) ;
        } ;
        // end toJSON filter
    }])


    .filter('unix2date', [function () {
        // return unix timestamp as a date
        return function (unixtimestamp) {
            return new Date(unixtimestamp * 1000).toISOString().substr(0,10) ;
        } ;
        // end toJSON filter
    }])

    .filter('shortCertUserId', [function () {
        // return part of cert_user_id before @
        return function (cert_user_id) {
            var i = cert_user_id.indexOf('@') ;
            return cert_user_id.substr(0,i) ;
        } ;
        // end toJSON filter
    }])

    .filter('privacyTitle', [function () {
        // title for user info privacy selection. mouse over help
        // Search - search word is stored on server together with a random public key.
        //          server will match search words and return matches to clients
        // Public - info send to other contact after search match. Info is show in contact suggestions (public profile)
        // Unverified - info send to other unverified contact after adding contact to contact list (show more contact info)
        // Verified - send to verified contact after verification through a secure canal (show more contact info)
        // Hidden - private, hidden information. Never send to server or other users.
        var privacy_titles = {
            Search: "Search values are stored in clear text in a database and are used when searching for contacts. Shared with other ZeroNet users. SQL like wildcards are supported (% and _)",
            Public: "Info is sent encrypted to other contact after search match. Public Info is shown in contact search and contact suggestions. Your public profile",
            Unverified: "Info is sent encrypted to other unverified contact after adding contact to contact list. Additional info about you to other contact",
            Verified: "Info is sent encrypted to verified contact after contact verification through a secure canal. Your private profile",
            Hidden: "Private, hidden information. Not stored in ZeroNet and not send to other users. But is used when searching for new contacts"
        };
        return function (privacy) {
            return privacy_titles[privacy] || 'Start typing. Select privacy level';
        } ;
        // end privacyTitle filter
    }])

;

// angularJS app end
