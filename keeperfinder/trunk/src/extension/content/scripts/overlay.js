/*
 * Copyright (c) 2008 David Huynh
 *
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 * */

var KeeperFinder = {
    _visible:               false,
    _selectedFolder:        null,
    _database:              null,
    _facets:                [],
    _currentSettings:       null,
    _dbChangeListener:      null,
    _processingUpdates:     false,
    _folderSettings:        null
};

KeeperFinder.log = function(msg) {
    Components.classes["@mozilla.org/consoleservice;1"]
        .getService(Components.interfaces.nsIConsoleService)
            .logStringMessage(msg);
};
KeeperFinder.warn = function(msg) {
    Components.classes["@mozilla.org/consoleservice;1"]
        .getService(Components.interfaces.nsIConsoleService)
            .logStringMessage(msg);
};
KeeperFinder.exception = function(e) {
    Components.classes["@mozilla.org/consoleservice;1"]
        .getService(Components.interfaces.nsIConsoleService)
            .logMessage(e);
};

KeeperFinder.cancelEvent = function(evt) {
    evt.returnValue = false;
    evt.cancelBubble = true;
    if ("preventDefault" in evt) {
        evt.preventDefault();
    }
    return false;
};

KeeperFinder.onLoad = function() {
    // initialization code
    KeeperFinder.initialized = true;
    KeeperFinder.strings = document.getElementById("keeperfinder-strings");
    
    window.addEventListener("mousemove", KeeperFinder.onWindowMouseMove, false);
    window.addEventListener("mouseup", KeeperFinder.onWindowMouseUp, false);
    
    var addFacetPopup = document.getElementById("keeperFinderPane-addFacetPopup");
    var makeMenuItem = function(n) {
        var config = KeeperFinder.FacetConfigurations.possibleFacets[n].config;
        var menuItem = document.createElement("menuitem");
        
        addFacetPopup.appendChild(menuItem);
        
        menuItem.setAttribute("label", config.facetLabel);
        menuItem.addEventListener('command', function() {
            KeeperFinder.appendFacet(n);
        }, false);
    };
    for (var n in KeeperFinder.FacetConfigurations.possibleFacets) {
        makeMenuItem(n);
    }
    
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-input").
        addEventListener('keyup', KeeperFinder.onContentSearchInputKeyUp, false);
    
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry-remove").
        addEventListener('click', KeeperFinder.onClearContentSearch, false);
};
window.addEventListener("load", KeeperFinder.onLoad, false);

KeeperFinder.onToggleKeeperFinder = function() {
    KeeperFinder._visible = !KeeperFinder._visible;
    
    document.getElementById("keeperFinder-theMenuItem").setAttribute("checked", KeeperFinder._visible);
    
    var deck = document.getElementById("keeperFinderPane-deck");
    var splitter = document.getElementById("keeperFinder-mainSplitter");
    
    deck.hidden = !KeeperFinder._visible;
    splitter.hidden = !KeeperFinder._visible;
}

KeeperFinder._getCurrentlySelectedFolder = function() {
    var folderTree = GetFolderTree();
    var folderSelection = folderTree.view.selection;
    var startIndex = {};
    var endIndex = {};

    folderSelection.getRangeAt(0, startIndex, endIndex);
    var folderResource = GetFolderResource(folderTree, startIndex.value);
    var msgFolder = folderResource.QueryInterface(Components.interfaces.nsIMsgFolder);
    
    return msgFolder;
};

var oldFolderPaneSelectionChange = FolderPaneSelectionChange;
FolderPaneSelectionChange = function() {
    var msgFolder = KeeperFinder._getCurrentlySelectedFolder();
    var changed = (KeeperFinder._selectedFolder != msgFolder);
    
    if (changed) {
        KeeperFinder.Indexer.cancelIndexingJob();
        KeeperFinder._relinquishThreadPaneOurselves();
    }
    
    oldFolderPaneSelectionChange();
    
    if (changed) {
        KeeperFinder._selectedFolder = msgFolder;
        
        var deck = document.getElementById("keeperFinderPane-deck");
        
        var msgDatabase = msgFolder.getMsgDatabase(msgWindow);
        if (msgDatabase) {
            deck.selectedIndex = 1; // UI for starting indexing
        } else {
            deck.selectedIndex = 0; // don't support message
        }
    }
};

KeeperFinder.disengage = function() {
    KeeperFinder._disposeFacets();
    KeeperFinder._relinquishThreadPaneOurselves();
    
    KeeperFinder._database = null;
    KeeperFinder._collection = null;
    
    var deck = document.getElementById("keeperFinderPane-deck");
    deck.selectedIndex = 1;
};

KeeperFinder.onStartIndexingFolder = function() {
    KeeperFinder._disposeFacets();
    
    var msgDatabase = KeeperFinder._selectedFolder.getMsgDatabase(msgWindow);
    KeeperFinder._dbChangeListener = KeeperFinder._createDBChangeListener();
    msgDatabase.AddListener(KeeperFinder._dbChangeListener);
    
    var progress = document.getElementById("keeperFinderPane-indexingLayer-progress");
    progress.value = 0;
    
    var deck = document.getElementById("keeperFinderPane-deck");
    deck.selectedIndex = 2; // indexing UI
    
    var remainingLabel = document.getElementById("keeperFinderPane-indexingLayer-remaining");
    remainingLabel.value = "";
    
    var start = new Date().getTime();
    
    KeeperFinder._database = KeeperFinder.Database.create();
    KeeperFinder.Indexer.startIndexingJob(
        KeeperFinder._database, 
        KeeperFinder._selectedFolder,
        function(percent) {
            if (percent > 5) {
                var now = new Date().getTime();
                var ellapsed = (now - start) / 1000; // in seconds
                var remaining = Math.ceil(ellapsed * (100 - percent) / percent);
                if (remaining >= 120) {
                    remainingLabel.value = String.substitute(
                        KeeperFinder.strings.getString("keeperFinder.remainingTime.minutes"),
                        [ Math.floor(remaining / 60) ]
                    );
                } else if (remaining > 60) {
                    var seconds = remaining - 60;
                    remainingLabel.value = String.substitute(
                        KeeperFinder.strings.getString("keeperFinder.remainingTime.oneMinuteMore"),
                        [ seconds ]
                    );
                } else if (remaining > 1) {
                    remainingLabel.value = String.substitute(
                        KeeperFinder.strings.getString("keeperFinder.remainingTime.seconds"),
                        [ remaining ]
                    );
                } else {
                    remainingLabel.value =
                        KeeperFinder.strings.getString("keeperFinder.remainingTime.almostDone");
                }
            }
            progress.value = percent;
        },
        KeeperFinder._onFinishIndexingJob
    );
};

KeeperFinder.onCancelIndexing = function() {
    KeeperFinder.Indexer.cancelIndexingJob();
    
    var deck = document.getElementById("keeperFinderPane-deck");
    deck.selectedIndex = 1;
};

KeeperFinder.toggleShowThreads = function() {
    KeeperFinder._currentSettings.showThreads = document.getElementById("keeperFinderPane-browsingLayer-showThreads").checked;
    KeeperFinder._rewireThreadPane();
    KeeperFinder._saveSettings();
};

KeeperFinder.toggleShowNewMessages = function() {
    KeeperFinder._currentSettings.showNewMessages = document.getElementById("keeperFinderPane-browsingLayer-showNewMessages").checked;
    KeeperFinder._rewireThreadPane();
    KeeperFinder._saveSettings();
};

KeeperFinder._disposeFacets = function() {
    for (var i = 0; i < KeeperFinder._facets.length; i++) {
        KeeperFinder._facets[i].dispose();
    }
    KeeperFinder._facets = [];
    
    var facetContainer = KeeperFinder._getFacetContainer();
    while (facetContainer.firstChild != null) {
        facetContainer.removeChild(facetContainer.firstChild);
    }
}

KeeperFinder._getFacetContainer = function() {
    return document.getElementById("keeperFinderPane-browsingLayer-facetContainer");
};

KeeperFinder._onFinishIndexingJob = function() {
    KeeperFinder._collection = KeeperFinder.Collection.createTypeBasedCollection(
        "default", KeeperFinder._database, [ "Message" ]);
    KeeperFinder._collection.addListener({
        onItemsChanged: KeeperFinder._onCollectionItemsChanged
    });
    
    KeeperFinder._retrieveSettings();
    
    document.getElementById("keeperFinderPane-browsingLayer-showThreads").checked = 
        KeeperFinder._currentSettings.showThreads;
    document.getElementById("keeperFinderPane-browsingLayer-showNewMessages").checked = 
        KeeperFinder._currentSettings.showNewMessages;
        
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-input").value = "";
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry").hidden = true;

    var deck = document.getElementById("keeperFinderPane-deck");
    deck.selectedIndex = 3;
    
    var spacer = document.createElement("spacer");
    spacer.style.width = "5px";
    KeeperFinder._getFacetContainer().appendChild(spacer);
    
    if ("facetNames" in KeeperFinder._currentSettings) {
        var facetNames = KeeperFinder._currentSettings.facetNames;
        for (var i = 0; i < facetNames.length; i++) {
            KeeperFinder.appendFacet(facetNames[i]);
        }
    } else {
        for (var n in KeeperFinder.FacetConfigurations.possibleFacets) {
            var config = KeeperFinder.FacetConfigurations.possibleFacets[n];
            if (config.showInitially) {
                KeeperFinder.appendFacet(n);
            }
        }
    }
    KeeperFinder._rewireThreadPane();
};

KeeperFinder.appendFacet = function(name) {
    var facetContainer = KeeperFinder._getFacetContainer();
    
    var vbox = document.createElement("vbox");
    vbox.style.width = "17em";
    facetContainer.insertBefore(vbox, facetContainer.lastChild);
    
    var facet = KeeperFinder.FacetConfigurations[name](
        KeeperFinder._database,
        KeeperFinder._collection,
        vbox
    );
    
    facetContainer.insertBefore(KeeperFinder.FacetUtilities.createFacetSplitter(), facetContainer.lastChild);
    
    KeeperFinder._facets.push(facet);
    
    KeeperFinder._saveSettings();
    
    return facet;
};

KeeperFinder.removeFacet = function(facet) {
    for (var i = 0; i < KeeperFinder._facets.length; i++) {
        if (KeeperFinder._facets[i] == facet) {
            facet.dispose();
            KeeperFinder._facets.splice(i, 1);
            
            var facetContainer = KeeperFinder._getFacetContainer();
            facetContainer.removeChild(facetContainer.childNodes[i * 2]);
            facetContainer.removeChild(facetContainer.childNodes[i * 2]); // remove the resizer, too
            
            KeeperFinder._saveSettings();
            break;
        }
    }
};

KeeperFinder._onCollectionItemsChanged = function() {
    if (!KeeperFinder._processingUpdates) {
        try {
            KeeperFinder._rewireThreadPane();
        } catch (e) {
            alert(e);
        }
    }
};

KeeperFinder._relinquishThreadPaneOurselves = function() {
    if ("_oldDBView" in KeeperFinder) {
        if (KeeperFinder._selectedFolder != null && KeeperFinder._dbChangeListener != null) {
            var msgDatabase = KeeperFinder._selectedFolder.getMsgDatabase(msgWindow);
            msgDatabase.RemoveListener(KeeperFinder._dbChangeListener);
            KeeperFinder._dbChangeListener = null;
        }
        
        var treeView = KeeperFinder._getOurOwnTreeView();
        treeView.selection.clearSelection();
        gCurrentMessageUri = null;
        gCurrentFolderUri = null;
        
        gDBView = KeeperFinder._oldDBView;
        delete KeeperFinder._oldDBView;
        
        GetThreadTree().treeBoxObject.view = gDBView;
    }
};

KeeperFinder._rewireThreadPane = function() {
    if (!("_oldDBView" in KeeperFinder)) {
        KeeperFinder._oldDBView = gDBView;
    }
    KeeperFinder._currentSettings.sortType = gDBView.sortType;
    KeeperFinder._currentSettings.sortOrder = gDBView.sortOrder;
    
    var collection = KeeperFinder._collection;
    var items = KeeperFinder._collection.getRestrictedItems();
    var database = KeeperFinder._database;
    
    var baseMsgKeyArray = [];
    items.visit(function(itemID) {
        baseMsgKeyArray.push(database.getObject(itemID, "msgKey"));
    });
    
    var treeView = new KeeperFinder.ThreadTreeView(
        gDBView,
        KeeperFinder._selectedFolder,
        baseMsgKeyArray,
        KeeperFinder._currentSettings
    );
    gDBView = treeView;
    
    GetThreadTree().treeBoxObject.view = treeView;
};

KeeperFinder._createDBChangeListener = function() {
    var msgDatabase = KeeperFinder._selectedFolder.getMsgDatabase(msgWindow);
    var l = new KeeperFinder.DBChangeListener(msgDatabase);
    l.onHdrChange = KeeperFinder._onHdrChange;
    l.onHdrAdded = KeeperFinder._onHdrAdded;
    l.onHdrDeleted = KeeperFinder._onHdrDeleted;
    return l;
};

KeeperFinder._onHdrChange = function(hdrChanged, oldFlags, newFlags, instigator) {
    if (KeeperFinder._hasOurOwnTreeView()) {
        KeeperFinder._getOurOwnTreeView().onHdrChange(hdrChanged);
    }
};

KeeperFinder._onHdrAdded = function(hdrChanged, parentKey, flags, instigator) {
    /*
     *  Flagging _processingUpdates will let us update the thread tree incrementally
     *  while the facets get updated the usual way. This avoids reconstructing the
     *  whole thread tree.
     */
    KeeperFinder._processingUpdates = true;
    
        var entityMap = {};
        var items = [];
        KeeperFinder.Indexer.indexMsg(hdrChanged, KeeperFinder._database, entityMap, items);
        KeeperFinder._database.loadItems(items, "");
        
        if (KeeperFinder._hasOurOwnTreeView()) {
            var msgKey = hdrChanged.messageKey;
            var itemID = KeeperFinder.Indexer.makeMessageID(msgKey);
            
            var collection = KeeperFinder._collection;
            var items = KeeperFinder._collection.getRestrictedItems()
            
            var treeView = KeeperFinder._getOurOwnTreeView();
            if (items.contains(itemID)) {
                treeView.onNewMatch(msgKey);
            } else {
                treeView.onHdrChange(hdrChanged);
            }
        }
    KeeperFinder._processingUpdates = false;
};

KeeperFinder._onHdrDeleted = function(hdrChanged, parentKey, flags, instigator) {
    var msgKey = hdrChanged.messageKey;
    var itemID = KeeperFinder.Indexer.makeMessageID(msgKey);
    KeeperFinder._database.removeItem(itemID);
    KeeperFinder._collection._update();
    
    // TODO: we need to update the thread tree in a more incremental manner
    
    if (KeeperFinder._hasOurOwnTreeView()) {
        var collection = KeeperFinder._collection;
        var items = KeeperFinder._collection.getRestrictedItems();
        
        var treeView = KeeperFinder._getOurOwnTreeView();
        if (!items.contains(itemID)) {
            treeView.onHdrChange(hdrChanged);
        }
    }
};

KeeperFinder._hasOurOwnTreeView = function() {
    return ("_oldDBView" in KeeperFinder);
};

KeeperFinder._getOurOwnTreeView = function() {
    return GetThreadTree().treeBoxObject.view.wrappedJSObject;
};

KeeperFinder._retrieveSettings = function() {
    KeeperFinder._ensureSettingsLoaded();
    
    var name = KeeperFinder._selectedFolder.name;
    if (name in KeeperFinder._folderSettings) {
        KeeperFinder._currentSettings = KeeperFinder._folderSettings[name];
    } else {
        KeeperFinder._currentSettings = {
            showThreads:        false,
            showNewMessages:    false
        };
    }
};

KeeperFinder._ensureSettingsLoaded = function() {
    if (KeeperFinder._folderSettings == null) {
        var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
        var s = null;
        try {
            s = prefs.getCharPref("extensions.keeperfinder.folderSettings");
        } catch (e) {}
        
        if (s != null && s.length > 0) {
            KeeperFinder._folderSettings = eval("(" + s + ")");
        } else {
            KeeperFinder._folderSettings = {}
        }
    }
};

KeeperFinder._saveSettings = function() {
    KeeperFinder._ensureSettingsLoaded();
    
    var settings = {
        showThreads:        document.getElementById("keeperFinderPane-browsingLayer-showThreads").checked,
        showNewMessages:    document.getElementById("keeperFinderPane-browsingLayer-showNewMessages").checked,
        facetNames:         []
    };
    
    for (var i = 0; i < KeeperFinder._facets.length; i++) {
        settings.facetNames.push(KeeperFinder._facets[i].name);
    }
    
    KeeperFinder._folderSettings[KeeperFinder._selectedFolder.name] = settings;
    
    var prefs = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefBranch);
    prefs.setCharPref(
        "extensions.keeperfinder.folderSettings", 
        KeeperFinder.JSON.toJSONString(KeeperFinder._folderSettings));
};

KeeperFinder._getFolderSettingsPrefKey = function() {
    return "keeperFinder.folder." + KeeperFinder._selectedFolder.name + ".settings";
}

KeeperFinder.createSearchSession = function() {
    var searchSession = Components.classes["@mozilla.org/messenger/searchSession;1"].
        createInstance(Components.interfaces.nsIMsgSearchSession);
        
    searchSession.addScopeTerm(
        KeeperFinder._selectedFolder.server.searchScope, 
        KeeperFinder._selectedFolder
    );
    
    return searchSession;
}

KeeperFinder.onContentSearchInputKeyUp = function(event) {
    if (event.keyCode == 13) {
        var contentSearchInput = document.getElementById("keeperFinderPane-browsingLayer-textSearch-input");
        var text = contentSearchInput.value.trim();
        
        if (text.length == 0) {
            document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry").hidden = true;
            KeeperFinder._collection.setContentSearch([], "all");
        } else {
            var searchMode = document.getElementById("keeperFinderPane-browsingLayer-textSearch-mode").value;
            var searchTerms = (searchMode == "phrase") ? [ text ] : text.split(" ");
            
            document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry-description").value = text;
            document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry").hidden = false;
            
            KeeperFinder._collection.setContentSearch(searchTerms, searchMode);
        }
    }
}

KeeperFinder.onClearContentSearch = function() {
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-input").value = "";
    document.getElementById("keeperFinderPane-browsingLayer-textSearch-pastEntry").hidden = true;
    KeeperFinder._collection.setContentSearch([], "all");
}
