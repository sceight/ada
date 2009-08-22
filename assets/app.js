/*
 * Ada
 * March 2009
 * sfsam
 */

var ada = function () {

    var REFRESH_MS = 120000,
        MAX_STATUSES = 100,
        PREFS_FILE = "prefs.json",
        SRCH_URL = "http://search.twitter.com/search?q=%23",
        TWTR_URL = "http://twitter.com/",
        HOME_URL = TWTR_URL + "statuses/friends_timeline.json",
        REPL_URL = TWTR_URL + "statuses/replies.json",
        UPDT_URL = TWTR_URL + "statuses/update.json",
        CFAV_URL = TWTR_URL + "favorites/create/",
        DFAV_URL = TWTR_URL + "favorites/destroy/",
        MSGS_URL = TWTR_URL + "direct_messages.json",
        DMSG_URL = TWTR_URL + "direct_messages/new.json",
        
        gReplRegex = /^@\w+\s/,      // match replies in update input
        gDmsgRegex = /^d\s(\w+)\s/,  // match dm's in update input
        gTailRegex = /[.,!?)]*$/ig,  // match .,!?) after url for inline links
        
        gMsg = null,
        
        gUser = "", 
        gPass = "",
        gAuthorized = false,
        gRememberMe = false,
        
        gAppName = "", gAppVersion = "",

        gLoaders = {}, // home, repl, msgs, updt, dmsg, cfav, dfav
        gStatuses = {},
        
        gTimer = null,
        gLoader = "home", // home, repl, msgs
        gShowInput = false,
        gInReplyToStatusId = null,
        
        gPrefsTimer = null;
        gPrefs = {
            showAvatars: true,
            themeName: "ada"
        };

    //-----------------------------------------------------------------------
    
    function adaTrace(str) {
        // comment out the following line for distribution builds
        //air.trace(str);
    }

    //-----------------------------------------------------------------------

    function shortenURL() {
        var url, ldr, req, status = 0;

        function onStatus(event) { 
            status = event.status;
        }

        function onError(event) { 
            adaTrace("shorten IOERROR: " + event.text);
            $("#dvthrobber").hide();
        }

        function onComplete(event) {
            var v = $.trim($("#dvupdateinput").val()) + " ";
            $("#dvthrobber").hide();
            if (status == 200) {
                $("#inurl").val("").blur();
                $("#dvupdateinput").val(v + event.target.data + " ").focus();
                $("#dvupdateinput")[0].setSelectionRange(1000, 1000);
                onUpdateChange();
            } else if (status == 500) {
                gMsg.say(event.target.data);
            } else {
                gMsg.say("Couldn't shorten your link. Try again later.");
                adaTrace("httpStatus = " + status);
                adaTrace(event.target.data);
            }
        }
        
        url = $.trim($("#inurl").val());
        if (!url || url === $("#inurl")[0].title) {
            gMsg.say("There is nothing to shorten! " +
                     "Enter a link you want shortened.");
            return;
        }
        
        ldr = new air.URLLoader();
        ldr.addEventListener(air.IOErrorEvent.IO_ERROR, onError);
        ldr.addEventListener(air.Event.COMPLETE, onComplete);
        ldr.addEventListener(air.HTTPStatusEvent.HTTP_RESPONSE_STATUS, 
            onStatus);

        req = new air.URLRequest("http://is.gd/api.php?longurl=" + url);

        try {
            $("#dvthrobber").show();
            ldr.load(req);
        } catch(error) {
            adaTrace("Unable to load url " + error);
            adaTrace(req.url);
        }
    }

    //-----------------------------------------------------------------------

    function getPrefs() {
        var file, fStream, prefs;
        file = air.File.applicationStorageDirectory.resolvePath(PREFS_FILE);
        fStream = new air.FileStream();
        try {
            fStream.open(file, air.FileMode.READ);
            prefs = JSON.parse(fStream.readUTFBytes(fStream.bytesAvailable));
            fStream.close();
        } catch (error) {
            adaTrace(error);
        }
        $.extend(gPrefs, prefs);
        
        // hack to get rid of a preference that is no longer used.
        // can eventually remove this.
        if (gPrefs.defaultTheme) {
            delete(gPrefs.defaultTheme);
        }
    }
    
    function setPrefs() {
        var file, fStream;
        file = air.File.applicationStorageDirectory.resolvePath(PREFS_FILE); 
        fStream = new air.FileStream(); 
        fStream.open(file, air.FileMode.WRITE); 
        fStream.writeUTFBytes(JSON.stringify(gPrefs)); 
        fStream.close();    
    }
    
    function saveAuth() {
        if (gRememberMe && !gAuthorized) {
            gAuthorized = true;
            gPrefs.user = gUser;
            gPrefs.pass = gPass;
            setPrefs();
        }
    }

    function saveBounds() {
        adaTrace('saveBounds');
        gPrefs.bounds = [
            window.nativeWindow.bounds.x, 
            window.nativeWindow.bounds.y,
            window.nativeWindow.bounds.width, 
            window.nativeWindow.bounds.height
        ];
        setPrefs();
    }

    //-----------------------------------------------------------------------

    function msg() {
        var timer, speed = 150;
        function say(msg, dur) {
            var duration = dur || 5000;
            if (timer) {
                window.clearTimeout(timer);
                timer = null;
            }
            $("#dvmessage").text(msg).show();
            timer = window.setTimeout(function () {
                $("#dvmessage").fadeOut(speed);
            }, duration);
        }
        return {say: say};
    }

    //-----------------------------------------------------------------------

    function status(baseURL) {
        var since_id = 10000,
            statuses = [];
            
        function getStatuses() {
            return statuses;
        }

        function reset() {
            since_id = 10000;
            statuses = [];
        }

        function updateStatuses(newStatuses) {
            adaTrace("updateStatuses " + newStatuses.length);
            statuses = newStatuses.concat(statuses);
            statuses.splice(MAX_STATUSES);
            if (statuses.length > 0) {
                since_id = statuses[0].id;
            }
        }
        
        function getURL() {
            var url = baseURL + "?count=" + MAX_STATUSES + 
                "&since_id=" + since_id;
            return  url;
        }
        
        function modFav(id, favorited) {
            adaTrace("modFav " + id + ", " + favorited);
            var i;
            for (i = 0; i < statuses.length; i++) {
                if (statuses[i].id === id) {
                    statuses[i].favorited = favorited;
                    break;
                }
            }
        }

        return {
            getStatuses: getStatuses,
            reset: reset,
            updateStatuses: updateStatuses,
            getURL: getURL,
            modFav: modFav
        }
    }

    //-----------------------------------------------------------------------

    function loader(onSuccess) {
        var ldr, status = 0;

        function onStatus(event) { 
            status = event.status;
        }

        function onError(event) { 
            adaTrace("IOERROR: " + event.text);
            $("#dvthrobber").hide();
        }

        function onComplete(event) {
            var data;
            $("#dvthrobber").hide();
            if (status == 200) {
                setTitle(gAppName + " : " + gUser);
                saveAuth();
                onSuccess(event.target.data);
            } else if (status == 400 || status == 403) {
                data = JSON.parse(event.target.data);
                if (data && data.error) {
                    gMsg.say("Twitter says: " + data.error);
                }
            } else if (status == 401) {
                showLogin(true);
            } else if (status == 404) {
                gMsg.say("Twitter returned a 404 Not Found error.");
            } else if (status == 500) {
                gMsg.say("Twitter returned a 500 Internal Server error.");
            } else if (status == 502) {
                gMsg.say("Twitter is down right now. Try again later.");
            } else if (status == 503) {
                gMsg.say("Twitter is overloaded now. Try again later.");
            } else {
                adaTrace("httpStatus = " + status);
                adaTrace(event.target.data);
            }
        }
        
        function load(req) {
            $("#dvthrobber").show();
            ldr.load(req);
        }

        ldr = new air.URLLoader();
        ldr.addEventListener(air.IOErrorEvent.IO_ERROR, onError);
        ldr.addEventListener(air.Event.COMPLETE, onComplete);
        ldr.addEventListener(air.HTTPStatusEvent.HTTP_RESPONSE_STATUS, 
            onStatus);

        return {
            load: load
        };  
    }

    //-----------------------------------------------------------------------

    function getRequest(url, isPost, data) {
        var req = new air.URLRequest(url);
        req.requestHeaders.push(new air.URLRequestHeader("Authorization", 
            "Basic " + Base64.encode(gUser + ":" + gPass)));
        req.authenticate = false;
        req.method = 
            isPost ? air.URLRequestMethod.POST : air.URLRequestMethod.GET;
        req.data = data;
        return req;
    }

    //-----------------------------------------------------------------------

    function clearTimer() {
        if (gTimer) {
            window.clearTimeout(gTimer);
            gTimer = null;
        }
    }

    //-----------------------------------------------------------------------

    function doIt() {
        var req = getRequest(gStatuses[gLoader].getURL());

        clearTimer();
        try {
            gLoaders[gLoader].load(req);
        } catch(error) {
            adaTrace("Unable to load url " + error);
            adaTrace(req.url);
        }
        gTimer = window.setTimeout(doIt, REFRESH_MS);
    }

    //-----------------------------------------------------------------------

    function onMove(event) {
        window.nativeWindow.startMove();
    }

    function onResize(event) {
        window.nativeWindow.startResize(air.NativeWindowResize.BOTTOM_RIGHT);
    }

    function onMinimize() {
        window.nativeWindow.visible = false;
    }
    
    function onMoveResize(event) {
        if (gPrefsTimer) {
            window.clearTimeout(gPrefsTimer);
        }
        gPrefsTimer = window.setTimeout(function () {   
            saveBounds();
        }, 4000);
    }
            
    function onExit(event) {
        saveBounds();
        air.NativeApplication.nativeApplication.icon.bitmaps = []; 
        air.NativeApplication.nativeApplication.exit();
    }

    function onLinkClick(event) {
        adaTrace(event.currentTarget);
        event.preventDefault();
        air.navigateToURL(new air.URLRequest(event.currentTarget));
    }

    function setTitle(title) {
        document.title = title;
        $("#dvtitlebar").text(title);
    }

    //-----------------------------------------------------------------------

    function showMain() {
        $("#dvabout").hide();
        $("#dvlogin").hide();
        $("#dvmain").show();
    }

    function showAbout() {
        clearTimer();
        $("#dvmain").hide();
        $("#dvlogin").hide();
        $("#dvabout").show();    
    }

    function showLogin(err) {    
        gUser = "";
        gPass = "";
        
        gShowInput = false;
        gLoader = "home";
        gInReplyToStatusId = null;
        
        gStatuses["home"].reset();
        gStatuses["repl"].reset();
        gStatuses["msgs"].reset();
        
        $("#dvupdateinput").val("");
        $("#inusernm,#inpasswd").val("");
        $("#inurl,#infilter").val("").blur();
        $("#spq").text(function () {
            var q = [
                "Hi there.", "You look nice.", "Keep being great!", "Smile!",
                "Nice haircut!", "Hello.", 
                "What's cookin'?", "You're cute!", "Make it happen!",
                "Think. Then tweet.", "Stay on target.", "I like your style.",
                "Stay cool.", "To err is hunam.", "You rock!",
                "Eat your veggies.", "You can do it."
            ];
            return q[Math.floor(Math.random() * q.length + 1) - 1];
        }());

        clearTimer();
        onUpdateChange();
        showUpdateArea(gShowInput);
        setTitle(gAppName);
        
        if (err) {
            gMsg.say("Nope! Try again!", 2000);
        }
           
        $("#dvabout").hide();    
        $("#dvmain").hide();    
        $("#dvlogin").show();
        $("#inusernm").focus();
    }

    //-----------------------------------------------------------------------

    function onSignout(event) {
        gAuthorized = false;
        gRememberMe = false;
        gPrefs.user = gPrefs.pass = "";
        setPrefs();
        showLogin(false);
    }

    function onSignin() {
        gUser = $.trim($("#inusernm").val());
        gPass = $.trim($("#inpasswd").val());
        if (!gUser || !gPass) {
            showLogin(true);
            return;
        }
        gRememberMe = $("#chkrememberme").val();
        doIt();
    }

    //-----------------------------------------------------------------------

    function onAvatars(event) {
        adaTrace("onAvatars");
        gPrefs.showAvatars = !gPrefs.showAvatars;
        if (gPrefs.showAvatars) {
            $("#miavatars").text("Hide pics");
        } else {
            $("#miavatars").text("Show pics");
        }
        setPrefs();
        drawStatuses();
    }
    
    //-----------------------------------------------------------------------

    function loadTheme(theme) {
        theme = theme || "ada";
        $("#ss")[0].href = "themes/" + theme + "/styles.css";
    }

    function onThemeChange(event) {
        var theme = $(event.target).text();
        adaTrace(theme);
        loadTheme(theme);
        gPrefs.themeName = theme;
        setPrefs();
        onTheme();  
    }

    function onTheme(event) {
        var themeDirs, i;
        themeDirs = air.File.applicationDirectory
            .resolvePath("assets/themes")
            .getDirectoryListing();
        $("#dvthemelist").empty();
        for (i = 0; i < themeDirs.length; i++) {
            $("#dvthemelist").append(
                $("<div></div>")
                    .addClass("menuitem")
                    .text(themeDirs[i].name)
                    .css("font-weight", 
                         (themeDirs[i].name == gPrefs.themeName) ?
                         "bold" : "normal")
                    .click(onThemeChange));
        }
        $("#dvthememenu").slideDown("fast");        
    }
    
    //-----------------------------------------------------------------------

    function onUpdateChange(event) {
        var len = 140 - $("#dvupdateinput").val().length,
            dmsgMatch;
        $("#dvupdatecount").text(len);
        if (gReplRegex.test($("#dvupdateinput").val())) {
            $("#bnupdatesend").text("Reply");
        } else {
            gInReplyToStatusId = null;
            dmsgMatch = $("#dvupdateinput").val().match(gDmsgRegex);
            if (dmsgMatch) {
                $("#bnupdatesend").text("Direct");
                $("#dvupdatecount").text(len + dmsgMatch[0].length);
            } else {
                $("#bnupdatesend").text("Send");
            }
        }
    }

    //-----------------------------------------------------------------------

    function showUpdateArea(show) {
        var h, speed = 200;
        if (show) {
            h = $("#dvupdatearea").outerHeight();
            $("#dvtimeline,#dvbottomborder").animate({
                bottom: (h + 26) + "px"
            }, speed, null);
            $("#dvupdatearea").slideDown(speed, function () {
                $("#dvupdateinput").focus();
                $("#dvupdateinput")[0].setSelectionRange(1000, 1000);
            });
            $("#infilter").fadeOut(speed, function () {
                $("#inurl,#dvurl").fadeIn(speed);                
            });
        } else {
            $("#dvupdatearea").slideUp(speed);
            $("#dvtimeline,#dvbottomborder").animate({
                bottom: "26px"
            }, speed);
            $("#inurl,#dvurl").fadeOut(speed, function () {
                $("#infilter").fadeIn(speed);    
            });
        }
    }

    function onToggleInputArea(event) {
        gShowInput = !gShowInput;
        showUpdateArea(gShowInput);
    }

    //-----------------------------------------------------------------------

    function parseParentNodeData(event) {
        // structure of id attribute of .dvtweet is...
        //   id:;user:;fav:;txt
        //   :; was chosen as the delimiter because hopefully(!?) it's unique
        // the buttons are inside .btncontainer which is inside .dvtweet,
        //   hence parentNode.parentNode...
        return event.target.parentNode.parentNode.id.split(":;");
    }

    function onFav(event) {
        var id_fav, url, vars, fav;
        id_fav = parseParentNodeData(event);
        adaTrace("onFav " + id_fav[0] + ", " + id_fav[2]);
        if (id_fav[2] == "true") {
            url = DFAV_URL + id_fav[0] + ".json";
            fav = "dfav";
        } else {
            url = CFAV_URL + id_fav[0]+ ".json";
            fav = "cfav";
        }
        vars = new air.URLVariables();
        vars["id"] = id_fav[0];        
        try {
            gLoaders[fav].load(getRequest(url, true, vars));
        } catch(error) {
            adaTrace('Unable to load URL: ' + error);
        }
    }

    function onReply(event) {
        var id_user = parseParentNodeData(event);
        gInReplyToStatusId = id_user[0];
        $("#dvupdateinput").val("@" + id_user[1] + " ");
        onUpdateChange();
        gShowInput = true;
        showUpdateArea(gShowInput);
    }

    function onRt(event) {
        var id_user_txt = parseParentNodeData(event),
            rt = "RT @" + id_user_txt[1] + " " + id_user_txt[3];
        $("#dvupdateinput").val(rt);
        onUpdateChange();
        gShowInput = true;
        showUpdateArea(gShowInput);
    }

    function onDM(event) {
        var id_user = parseParentNodeData(event);
        $("#dvupdateinput").val("d " + id_user[1] + " ");
        onUpdateChange();
        gShowInput = true;
        showUpdateArea(gShowInput);
    }

    //-----------------------------------------------------------------------

    function onLoadSuccess(data) {
        gStatuses[gLoader].updateStatuses(JSON.parse(data));
        drawStatuses();
    }

    function onUpdtSuccess(data) {
        $("#dvupdateinput").val("");
        onUpdateChange();
        gShowInput = false;
        showUpdateArea(gShowInput);
        doIt();    
    }

    function onCFavSuccess(data) {
        var d = JSON.parse(data);
        gStatuses[gLoader].modFav(d.id, true);
        gMsg.say("Tweet fav'd.", 2000);
        drawStatuses();
    }

    function onDFavSuccess(data) {
        var d = JSON.parse(data);
        gStatuses[gLoader].modFav(d.id, false);
        gMsg.say("Tweet unfav'd.", 2000);
        drawStatuses();
    }

    //-----------------------------------------------------------------------

    function onUpdate() {
        adaTrace("onUpdate");
        var vars,
            url = UPDT_URL,
            loader = "updt",
            recipient,
            txt = $.trim($("#dvupdateinput").val());
        if (txt === "") {
            gMsg.say("That's just whitespace. I'm not sending that!");
            return;
        }
        vars = new air.URLVariables();
        vars["source"] = gAppName.toLowerCase();
        recipient = txt.match(gDmsgRegex);
        if (recipient) {
            url = DMSG_URL;
            loader = "dmsg";
            vars["user"] = recipient[1];
            vars["text"] = txt.substring(recipient[0].length);
        } else {
            vars["status"] = txt;
            vars["in_reply_to_status_id"] = gInReplyToStatusId;
        }
        try {
            gLoaders[loader].load(getRequest(url, true, vars));
        } catch(error) {
            adaTrace('Unable to load URL: ' + error);
        }
    }

    //-----------------------------------------------------------------------

    function drawStatuses() {
        var dvtweet, id, user, img, when, favorited, txt, i, tailMatch,
            dvbtncontainer, rawtxt, 
            tweets = gStatuses[gLoader].getStatuses(),
            imgCache = {};

        adaTrace("drawStatuses: " + gLoader + " " + tweets.length);

        $("#dvtimeline").empty();

        if (tweets.length == 0) {
            $("#dvtimeline")
                .append($("<div></div>")
                    .css("padding", "10px")
                    .html("There are no messages."));
            return;
        }

        for (i = 0; i < tweets.length; i++) {
            id = tweets[i].id;
            when = tweets[i].created_at;
            favorited = tweets[i].favorited;
            rawtxt = $.trim(tweets[i].text);

            if (gLoader == "msgs") {
                user = tweets[i].sender.screen_name;
                img = tweets[i].sender.profile_image_url;
            } else {
                user = tweets[i].user.screen_name;
                img = tweets[i].user.profile_image_url;
            }
            
            // This only partially addresses the profile picture 
            // caching problem. 
            // - It works for the situation where a user has changed his 
            // profile pic and then posts an update. The update will point
            // to the new pic. The new pic will go into this cache and 
            // older tweets from this user will use the new pic from the cache
            // rather than the old pic that those old tweets point to.
            // - It doesn't address the situation where a user changes his
            // profile pic but doesn't make a new update. We will only pull
            // old tweets from this user and those old tweets still point
            // to the old profile pic which is an expired (broken) url.
            if (imgCache[user]) {
                img = imgCache[user];
            } else {
                imgCache[user] = img;
            }

            txt = rawtxt
                .replace(/\b(https?:\/\/[^\s+\"\<\>]+)/ig, function (url) {
                    // We matched a url. If there is punctuation at the
                    // end of the url, we need to remove it.
                    tailMatch = url.match(gTailRegex);
                    if (tailMatch[0]) {
                        url = url.slice(0, -tailMatch[0].length);
                    }
                    return "<a href='" + url + "' class='link'>" + url + 
                           "</a>" + tailMatch[0];
                })
                .replace(/\@(\w+)/g,
                    "@<a href='" + TWTR_URL + "$1' class='link'>$1</a>")
                .replace(/\#(\w+)/g,
                    "#<a href='" + SRCH_URL + "$1' class='link'>$1</a>");

            dvtweet = $("<div></div>")
                .addClass("dvtweet")
                .attr("id", id + ":;" + user + ":;" + favorited + ":;" + rawtxt)
                .html("<div class='tweetpic'>" +
                      "  <a href='" + TWTR_URL + user + "' class='link'>" + 
                      "    <img width='24' src='" + img + "' /></a></div>" +
                      "<a href='" + TWTR_URL + user + "' " +
                      "class='link screenname'>" + user + "</a> " + 
                      txt + "<br />" +
                      "<a href='" + TWTR_URL + user + "/status/" + id + "' " + 
                      "class='link prettyDate'>" + 
                      relative_time(when) + "</a>");

            dvbtncontainer = $("<div></div>").addClass("btncontainer");
            dvtweet.append(dvbtncontainer);

            if (gLoader == "msgs") {
                dvbtncontainer
                    .append($("<div>dm</div>")
                        .addClass("btndm")
                        .click(onDM));
                dvtweet
                    .hover(function () {
                        $(".btndm", $(this)).show();
                    }, function () {
                        $(".btndm", $(this)).hide();
                    });
            } else {
                dvbtncontainer
                    .append($("<div></div>")
                        .addClass(favorited ? "btnunfav" : "btnfav")
                        .click(onFav));
                if (gUser != user) {
                    dvbtncontainer
                        .append($("<div>reply</div>")
                            .addClass("btnreply")
                            .click(onReply))
                        .append($("<div>rt</div>")
                            .addClass("btnrt")
                            .click(onRt));
                }
                dvtweet
                    .hover(function () {
                        $(".btnfav,.btnreply,.btnrt", $(this)).show();
                    }, function () {
                        $(".btnfav,.btnreply,.btnrt", $(this)).hide();
                    });
            }

            $("#dvtimeline").append(dvtweet);
        }
        $(".link").click(onLinkClick);
        $(".tweetpic").toggle(gPrefs.showAvatars);
        doFilter();
        showMain();
    }

    /* removed for version 1.20
    function html_entity_decode(str) {
        return str;
        return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    }
    */
        
    //-----------------------------------------------------------------------

    function doFilter() {
        var regex, p = $.trim($("#infilter").val());
        if (p === $("#infilter")[0].title) {
            p = "";
        }    
        regex = new RegExp("^" + p, "i");
        $(".dvtweet").each(function () {
            var id_user = this.id.split(":;");
            if (regex.test(id_user[1])) {
                $(this).show();
            } else {
                $(this).hide();
            }
        });
    }

    //-----------------------------------------------------------------------

    function setUpMainMenu() {
        var menuTimer = null, menuShowing = false;

        function showMenu() {
            if (menuTimer) {
                window.clearTimeout(menuTimer);
                menuTimer = null;
            }
            if (menuShowing) {
                return;
            }
            $("#mihome,#mirepl,#mimsgs").css("font-weight", "normal");
            $("#mi" + gLoader).css("font-weight", "bold");
            menuTimer = window.setTimeout(function () {
                $("#dvmainmenu").slideDown("fast", function () {
                    menuShowing = true;
                    menuTimer = null;
                });
            }, 200);        
        }
        
        function hideMenu(force) {
            if (force) {
                $("#dvmainmenu").slideUp("fast", function () {
                    menuShowing = false;
                    menuTimer = null;
                });
            }
            if (menuTimer) {
                window.clearTimeout(menuTimer);
                menuTimer = null;
            }
            menuTimer = window.setTimeout(function () {
                $("#dvmainmenu").slideUp("fast", function () {
                    menuShowing = false;
                    menuTimer = null;
                });
            }, 400);        
        }
    
        // menu slide in/out
        $("#dvmenu").hover(showMenu);
        $("#dvmenucontainer").hover(showMenu, function () {
            hideMenu();
        });
        $(".menuitem").click(function () {
            hideMenu(true);
        });

        $("#mihome").click(function () {
            gLoader = "home";
            doIt(); 
        });
        $("#mirepl").click(function () { 
            gLoader = "repl";
            doIt(); 
        });
        $("#mimsgs").click(function () { 
            gLoader = "msgs";
            doIt(); 
        });
        $("#mirefresh").click(function () {
            gStatuses[gLoader].reset();
            doIt();
        });
        $("#miavatars").click(onAvatars);
        $("#mitheme").click(onTheme);
        $("#miabout").click(showAbout);	
        $("#misignout").click(onSignout);
    }

    //-----------------------------------------------------------------------

    function init() {
        var parser, xml_obj, root, iconLoad, iconMenu, exitCmd,
            moveable, i;

        // Window min/max dimensions
        window.nativeWindow.minSize = new air.Point(170, 200);
        window.nativeWindow.maxSize = new air.Point(1200, 1200);

        // Get app name and version from configuration XML file
        parser = new DOMParser(); 
        xml_obj = parser.parseFromString(
            air.NativeApplication.nativeApplication.applicationDescriptor,
            "text/xml"); 
        root = xml_obj.getElementsByTagName("application")[0]; 
        gAppVersion = root.getElementsByTagName("version")[0].firstChild.data; 
        gAppName = root.getElementsByTagName("filename")[0].firstChild.data; 
        
        setTitle(gAppName);
        $("#abouttitle").text(gAppName);
        $("#aboutversion").text(gAppVersion);

        // System tray
        if (air.NativeApplication.supportsSystemTrayIcon) {
            iconMenu = new air.NativeMenu(); 
            exitCmd = iconMenu.addItem(new air.NativeMenuItem("Exit")); 
            exitCmd.addEventListener(air.Event.SELECT, onExit); 
            iconLoad = new air.Loader(); 
            iconLoad.contentLoaderInfo.addEventListener(
                air.Event.COMPLETE, function (event) {
                    air.NativeApplication.nativeApplication.icon.bitmaps =
                        [event.target.content.bitmapData]; 
                }); 
            iconLoad.load(new air.URLRequest("/icons/icon16.png")); 
            air.NativeApplication.nativeApplication.icon.tooltip = gAppName;
            air.NativeApplication.nativeApplication.icon.menu = iconMenu;
            air.NativeApplication.nativeApplication.icon.addEventListener(
                "click", function (event) {
                    adaTrace("Systray click");
                    air.NativeApplication.nativeApplication.activate();
                    window.nativeWindow.activate();
                });
        } 
        
        // Assign moveable div's so we can drag the window around.
        moveable = [
            "#dvtitlebar", "#dvcontainer",
            "#dvthrobber", "#dvabout", "#dvlogin"
        ];
        for (i = 0; i < moveable.length; i++) {
            $(moveable[i]).mousedown(onMove);
        }

        // Assign event listeners
        $("#dvgripper").mousedown(onResize);
        $("#bnsignin").click(onSignin);
        $("#bnaboutok").click(doIt);
        $("#bnthemeok").click(function () {
            $("#dvthememenu").slideUp("fast");
        });
        $("#dvexit").click(onExit);
        $("#dvmin").click(onMinimize);
        $("#dvtoggle").click(onToggleInputArea);
        $("#bnupdatesend").click(onUpdate);
        $("#dvurl").click(shortenURL)
        $("#inurl").keypress(function (e) {
            if (e.charCode === 13) shortenURL();
        });
        $("#infilter").keyup(doFilter);
        $("#inurl,#infilter")
            .focus(function () {
                if ($(this).val() === $(this)[0].title) {
                    $(this).toggleClass("inputfaint", false);
                    $(this).val("");
                }
            })
            .blur(function () {
                if ($.trim($(this).val()) === "") {
                    $(this).toggleClass("inputfaint", true);
                    $(this).val($(this)[0].title);
                }
            })
            .blur();
        
        window.htmlLoader.filters = window.runtime.Array(
            new window.runtime.flash.filters.DropShadowFilter(
                0, 90, 0, 1, 3, 3));

        window.nativeWindow.addEventListener(
            air.NativeWindowBoundsEvent.RESIZE, onMoveResize);
        window.nativeWindow.addEventListener(
            air.NativeWindowBoundsEvent.MOVE, onMoveResize);

        air.NativeApplication.nativeApplication.addEventListener(
            air.InvokeEvent.INVOKE, function (event) {
                adaTrace("Dock click");
                air.NativeApplication.nativeApplication.activate();
                window.nativeWindow.activate();
            });

        setUpMainMenu();

        // URL loaders for Twitter actions
        gLoaders["home"] = loader(onLoadSuccess);
        gLoaders["repl"] = loader(onLoadSuccess);
        gLoaders["msgs"] = loader(onLoadSuccess);
        gLoaders["dmsg"] = loader(onUpdtSuccess);
        gLoaders["updt"] = loader(onUpdtSuccess);
        gLoaders["cfav"] = loader(onCFavSuccess);
        gLoaders["dfav"] = loader(onDFavSuccess);

        // State info for Twitter statuses
        gStatuses["home"] = status(HOME_URL);
        gStatuses["repl"] = status(REPL_URL);
        gStatuses["msgs"] = status(MSGS_URL);
        
        gMsg = msg();

        getPrefs();
        loadTheme(gPrefs.themeName);
        $("#miavatars").text(gPrefs.showAvatars ? 
            "Hide pics" : "Show pics");            
        if (gPrefs.bounds) {
            window.nativeWindow.bounds = new air.Rectangle(
                gPrefs.bounds[0], gPrefs.bounds[1], 
                gPrefs.bounds[2], gPrefs.bounds[3]);
        }
        if (gPrefs.user && gPrefs.pass) {
            gUser = gPrefs.user;
            gPass = gPrefs.pass;
            doIt();
        } else {
            showLogin(false);
        }
        
        window.setTimeout(function () {
            window.nativeWindow.visible = true;
        }, 500);
    }

    function ini() {
        var a, b, appUpdater;
        // Set up updater framework
        appUpdater = new runtime.air.update.ApplicationUpdaterUI();
        appUpdater.updateURL = "http://madan.org/ada/update.xml"; 
        appUpdater.delay = 1;
        appUpdater.isCheckForUpdateVisible = false;
        appUpdater.initialize();
        a = new air.NativeWindowInitOptions(); 
        a.systemChrome = air.NativeWindowSystemChrome.NONE; 
        a.type = air.NativeWindowType.LIGHTWEIGHT;
        a.maximizable = false;
        a.transparent = true;
        b = air.HTMLLoader.createRootWindow(false, a, false, 
            new air.Rectangle(
                (air.Capabilities.screenResolutionX - 180) / 2, 
                (air.Capabilities.screenResolutionY - 300) / 2,
                180, 300));
        b.load(new air.URLRequest("app.html"));
    }
    
    return {
        ini: ini,
        init: init,
        onUpdateChange: onUpdateChange
    };

}();
