/**
 * Vida6 - An ES6 controller for Verovio
 *
 * Required options on initialization (or set later with setDefaults()):
 * -parentElement: a JS DOM API node in which to crete the Vida UI
 * -workerLocation: location of the verovioWorker.js script included in this repo; relative to vida.js or absolute-pathed
 * -verovioLocation: location of the verovio toolkit copy you wish to use, relative to verovioWorker.js or absolute-pathed
 *
 * Optional options:
 * -debug: will print out console errors when things go wrong
 */

export class VidaController
{
    constructor(options)
    {
        options = options || {};
        if (!options.workerLocation || !options.verovioLocation)
            return console.error("The VidaController must be initialized with both the 'workerLocation' and 'verovioLocation' parameters.");

        // Keeps track of callback functions for worker calls
        this.ticketID = 0;
        this.tickets = {};

        // Keeps track of the worker reserved for each view
        this.workerLocation = options.workerLocation;
        this.verovioLocation = options.verovioLocation;
        this.viewWorkers = [];
        this.views = {}; // map to make sure that indexes line up
    }

    register(viewObj)
    {
        const newWorker = new Worker(this.workerLocation);
        const workerIndex = this.viewWorkers.push(newWorker) - 1; // 1-indexed length to 0-indexed value
        this.views[workerIndex] = viewObj;

        newWorker.onmessage = (event) => {
            let eventType = event.data[0];
            let ticket = event.data[1];
            let params = event.data[2];

            if (eventType === "error")
            {
                console.log("Error message from Verovio:", params);
                if (ticket) delete this.tickets[ticket];
            }

            else if (this.tickets[ticket])
            {
                this.tickets[ticket].call(viewObj, params);
                delete this.tickets[ticket];
            }
            else console.log("Unexpected worker case:", event);
        };
        this.contactWorker('setVerovio', {'location': this.verovioLocation}, workerIndex);
        return workerIndex;
    }

    contactWorker(messageType, params, viewIndex, callback)
    {
        // array passed is [messageType, ticketNumber, dataObject]
        this.tickets[this.ticketID] = callback;
        this.viewWorkers[viewIndex].postMessage([messageType, this.ticketID, params]);
        this.ticketID++;
    }

    setMEIForViewIndex(viewIndex, MEI)
    {
        this.views[viewIndex].refreshVerovio(MEI);
    }
}

export class VidaView
{
    constructor(options)
    {
        options = options || {};
        if (!options.controller || !options.parentElement)
            return console.error("All VidaView objects must be initialized with both the 'controller' and 'parentElement' parameters.");

        this.parentElement = options.parentElement;
        this.debug = options.debug;
        options.iconClasses = options.iconClasses || {};
        this.iconClasses = {
            'nextPage': options.iconClasses.nextPage || "",
            'prevPage': options.iconClasses.prevPage || "",
            'zoomIn': options.iconClasses.zoomIn || "",
            'zoomOut': options.iconClasses.zoomOut || ""
        };

        this.controller = options.controller;
        this.viewIndex = this.controller.register(this);

        // One of the little quirks of writing in ES6, bind events
        this.bindListeners();

        // initializes ui underneath the parent element, as well as Verovio communication
        this.initializeLayoutAndWorker();

        // Initialize the events system and alias the functions
        this.events = new Events();
        this.publish = this.events.publish;
        this.subscribe = this.events.subscribe;
        this.unsubscribe = this.events.unsubscribe;

        // "Global" variables
        this.resizeTimer;
        this.verovioSettings = {
            pageHeight: 100,
            pageWidth: 100,
            inputFormat: 'mei', // change at thy own risk
            scale: 40,
            border: 50,
            noLayout: 0,    // 1 or 0 (NOT boolean, but mimicing it) for whether the page will display horizontally or vertically
            ignoreLayout: 1,
            adjustPageHeight: 1
        };
        this.mei = undefined; // saved in Vida as well as the worker, unused for now
        this.verovioContent = undefined; // svg output
        this.systemData = [ // stores offsets and ids of each system
            /* {
                'topOffset':
                'id':
            } */
        ];
        this.currentSystem = 0; // topmost system object within the Vida display
        this.totalSystems = 0; // total number of system objects

        // For dragging
        this.clickedPage; // last clicked page
        this.draggingActive; // boolean "active"
        this.highlightedCache = [];
        this.dragInfo = {

        /*
            "x": position of clicked note
            "initY": initial Y position
            "svgY": scaled initial Y position
            "pixPerPix": conversion between the above two
        */

        };

        if (options.mei) this.refreshVerovio(options.mei);
    }

    destroy()
    {
        window.addEventListener('resize', this.boundResize);

        this.ui.svgOverlay.removeEventListener('scroll', this.boundSyncScroll);
        this.ui.nextPage.removeEventListener('click', this.boundGotoNext);
        this.ui.prevPage.removeEventListener('click', this.boundGotoPrev);
        this.ui.orientationToggle.removeEventListener('click', this.boundOrientationToggle);
        this.ui.zoomIn.removeEventListener('click', this.boundZoomIn);
        this.ui.zoomOut.removeEventListener('click', this.boundZoomOut);

        this.ui.svgOverlay.removeEventListener('click', this.boundObjectClick);
        const notes = this.ui.svgOverlay.querySelectorAll(".note");
        for (var idx = 0; idx < notes.length; idx++)
        {
            const note = notes[idx];

            note.removeEventListener('mousedown', this.boundMouseDown);
            note.removeEventListener('touchstart', this.boundMouseDown);
        }

        document.removeEventListener("mousemove", this.boundMouseMove);
        document.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("touchmove", this.boundMouseMove);
        document.removeEventListener("touchend", this.boundMouseUp);

        this.events.unsubscribeAll();
    }

    /**
     * Init code separated out for cleanliness' sake
     */
    initializeLayoutAndWorker()
    {
        this.ui = {
            parentElement: this.parentElement, // must be DOM node
            svgWrapper: undefined,
            svgOverlay: undefined,
            controls: undefined,
            popup: undefined
        };

        this.ui.parentElement.innerHTML = '<div class="vida-wrapper">' +
            '<div class="vida-toolbar">' +
                '<div class="vida-page-controls vida-toolbar-block">' +
                    '<div class="vida-button vida-prev-page vida-direction-control ' + this.iconClasses.prevPage + '"></div>' +
                    '<div class="vida-button vida-next-page vida-direction-control ' + this.iconClasses.nextPage + '"></div>' +
                '</div>' +
                '<div class="vida-orientation-controls vida-button vida-toolbar-block">' +
                    '<div class="vida-orientation-toggle">Toggle orientation</div>' +
                '</div>' +
                '<div class="vida-zoom-controls vida-toolbar-block">' +
                    '<span class="vida-button vida-zoom-in vida-zoom-control ' + this.iconClasses.zoomIn + '"></span>' +
                    '<span class="vida-button vida-zoom-out vida-zoom-control ' + this.iconClasses.zoomOut + '"></span>' +
                '</div>' +
            '</div>' +
            '<div class="vida-svg-wrapper vida-svg-object" style="z-index: 1; position:absolute;"></div>' +
            '<div class="vida-svg-overlay vida-svg-object" style="z-index: 1; position:absolute;"></div>' +
            '<div class="vida-loading-popup"></div>' +
        '</div>';

        window.addEventListener('resize', this.boundResize);

        // If this has already been instantiated , undo events
        if (this.ui && this.ui.svgOverlay) this.destroy();

        // Set up the UI object
        this.ui.svgWrapper = this.ui.parentElement.querySelector(".vida-svg-wrapper");
        this.ui.svgOverlay = this.ui.parentElement.querySelector(".vida-svg-overlay");
        this.ui.controls = this.ui.parentElement.querySelector(".vida-page-controls");
        this.ui.popup = this.ui.parentElement.querySelector(".vida-loading-popup");
        this.ui.nextPage = this.ui.parentElement.querySelector(".vida-next-page");
        this.ui.prevPage = this.ui.parentElement.querySelector(".vida-prev-page");
        this.ui.orientationToggle = this.ui.parentElement.querySelector(".vida-orientation-toggle");
        this.ui.zoomIn = this.ui.parentElement.querySelector(".vida-zoom-in");
        this.ui.zoomOut = this.ui.parentElement.querySelector(".vida-zoom-out");

        // synchronized scrolling between svg overlay and wrapper
        this.ui.svgOverlay.addEventListener('scroll', this.boundSyncScroll);

        // control bar events
        this.ui.nextPage.addEventListener('click', this.boundGotoNext);
        this.ui.prevPage.addEventListener('click', this.boundGotoPrev);
        this.ui.orientationToggle.addEventListener('click', this.boundOrientationToggle);
        this.ui.zoomIn.addEventListener('click', this.boundZoomIn);
        this.ui.zoomOut.addEventListener('click', this.boundZoomOut);

        // simulate a resize event
        this.updateDims();
    }

    // Necessary for how ES6 "this" works
    bindListeners()
    {
        this.boundSyncScroll = (evt) => this.syncScroll(evt);
        this.boundGotoNext = (evt) => this.gotoNextPage(evt);
        this.boundGotoPrev = (evt) => this.gotoPrevPage(evt);
        this.boundOrientationToggle = (evt) => this.toggleOrientation(evt);
        this.boundZoomIn = (evt) => this.zoomIn(evt);
        this.boundZoomOut = (evt) => this.zoomOut(evt);
        this.boundObjectClick = (evt) => this.objectClickListener(evt);

        this.boundMouseDown = (evt) => this.mouseDownListener(evt);
        this.boundMouseMove = (evt) => this.mouseMoveListener(evt);
        this.boundMouseUp = (evt) => this.mouseUpListener(evt);

        this.boundResize = (evt) => this.resizeComponents(evt);
    }

    /**
     * Code for contacting the controller work; renderPage is used as the callback multiple times.
     */

    getViewIndex()
    {
        return this.viewIndex;
    }

    contactWorker(messageType, params, callback)
    {
        this.controller.contactWorker(messageType, params, this.viewIndex, callback);
    }

    renderPage(params)
    {
        const vidaOffset = this.ui.svgWrapper.getBoundingClientRect().top;
        const systemWrapper = this.ui.parentElement.querySelector(".vida-system-wrapper[data-index='" + params.pageIndex + "']");
        systemWrapper.innerHTML = params.svg;

        // Add data about the available systems here
        const systems = this.ui.svgWrapper.querySelectorAll('g[class=system]');
        for(var sIdx = 0; sIdx < systems.length; sIdx++)
            this.systemData[sIdx] = {
                'topOffset': systems[sIdx].getBoundingClientRect().top - vidaOffset - this.verovioSettings.border,
                'id': systems[sIdx].id
            };

        // update the global tracking var
        this.totalSystems = this.systemData.length;

        // create the overlay, save the content, remove the popup, make sure highlights are up to date
        if(params.createOverlay) this.createOverlay();
        this.verovioContent = this.ui.svgWrapper.innerHTML;
        this.ui.popup.remove();
        this.reapplyHighlights();

        // do not reset this.mei to what Verovio thinks it should be, as that'll cause significant problems
        this.updateNavIcons();
        this.events.publish("PageRendered", [this.mei]);
    }

    initPopup(text)
    {
        this.ui.popup.style.top = this.ui.parentElement.getBoundingClientRect().top + 50;
        this.ui.popup.style.left = this.ui.parentElement.getBoundingClientRect().left + 30;
        this.ui.popup.innerHTML = text;
        this.ui.popup.style.display = "block";
    }

    hidePopup()
    {
        this.ui.popup.innerHTML = "";
        this.ui.popup.style.display = "none";
    }

    // Used to reload Verovio, or to provide new MEI
    refreshVerovio(mei)
    {
        if (mei) this.mei = mei;
        if (!this.mei) return;

        this.ui.svgOverlay.innerHTML = this.ui.svgWrapper.innerHTML = this.verovioContent = "";
        this.verovioSettings.pageHeight = Math.max(this.ui.svgWrapper.clientHeight * (100 / this.verovioSettings.scale) - this.verovioSettings.border, 100) >> 0; // minimal value required by Verovio
        this.verovioSettings.pageWidth = Math.max(this.ui.svgWrapper.clientWidth * (100 / this.verovioSettings.scale) - this.verovioSettings.border, 100) >> 0; // idem

        this.contactWorker('setOptions', {'options': JSON.stringify(this.verovioSettings)});
        this.contactWorker('loadData', {'mei': this.mei + "\n"}, (params) => {
            for(var pIdx = 0; pIdx < params.pageCount; pIdx++)
            {
                this.ui.svgWrapper.innerHTML += "<div class='vida-system-wrapper' data-index='" + pIdx + "'></div>";
                this.contactWorker("renderPage", {'pageIndex': pIdx}, this.renderPage);
            }
        });
    }

    createOverlay()
    {
        // Copy wrapper HTML to overlay
        this.ui.svgOverlay.innerHTML = this.ui.svgWrapper.innerHTML;

        // Make all <g>s and <path>s transparent, hide the text
        var idx;
        const gElems = this.ui.svgOverlay.querySelectorAll("g");
        for (idx = 0; idx < gElems.length; idx++)
        {
            gElems[idx].style.strokeOpacity = 0.0;
            gElems[idx].style.fillOpacity = 0.0;
        }
        const pathElems = this.ui.svgOverlay.querySelectorAll("path");
        for (idx = 0; idx < pathElems.length; idx++)
        {
            pathElems[idx].style.strokeOpacity = 0.0;
            pathElems[idx].style.fillOpacity = 0.0;
        }
        delete this.ui.svgOverlay.querySelectorAll("text");

        // Add event listeners for click
        this.ui.svgOverlay.removeEventListener('click', this.boundObjectClick);
        this.ui.svgOverlay.addEventListener('click', this.boundObjectClick);
        const notes = this.ui.svgOverlay.querySelectorAll(".note");
        for (idx = 0; idx < notes.length; idx++)
        {
            const note = notes[idx];

            note.removeEventListener('mousedown', this.boundMouseDown);
            note.removeEventListener('touchstart', this.boundMouseDown);
            note.addEventListener('mousedown', this.boundMouseDown);
            note.addEventListener('touchstart', this.boundMouseDown);
        }
        // this.ui.svgOverlay.querySelectorAll("defs").append("filter").attr("id", "selector");
        // resizeComponents();
    }

    updateNavIcons()
    {
        if (this.verovioSettings.noLayout || (this.currentSystem === this.totalSystems - 1)) this.ui.nextPage.style.visibility = 'hidden';
        else this.ui.nextPage.style.visibility = 'visible';

        if (this.verovioSettings.noLayout || (this.currentSystem === 0)) this.ui.prevPage.style.visibility = 'hidden';
        else this.ui.prevPage.style.visibility = 'visible';
    }

    updateZoomIcons()
    {
        if (this.verovioSettings.scale == 100) this.ui.zoomIn.style.visibility = 'hidden';
        else this.ui.zoomIn.style.visibility = 'visible';

        if (this.verovioSettings.scale == 10) this.ui.zoomOut.style.visibility = 'hidden';
        else this.ui.zoomOut.style.visibility = 'visible';
    }

    scrollToObject(id)
    {
        var obj = this.ui.svgOverlay.querySelector("#" + id).closest('.vida-svg-wrapper');
        scrollToPage(obj.parentNode.children.indexOf(obj));
    }

    scrollToPage(pageNumber)
    {
        var toScrollTo = this.systemData[pageNumber].topOffset;
        this.ui.svgOverlay.scrollTop = toScrollTo;
        this.updateNavIcons();
    }

    /**
     * Event listeners - Display
     */
    resizeComponents()
    {
        // Immediately: resize larger components
        this.updateDims();

        // Set timeout for resizing Verovio once full resize action is complete
        clearTimeout(this.resizeTimer);
        const self = this;
        this.resizeTimer = setTimeout(function ()
        {
            self.refreshVerovio();
        }, 200);
    }

    // Abstracted out because it's reused
    updateDims()
    {
        this.ui.svgOverlay.style.height = this.ui.svgWrapper.style.height = this.ui.parentElement.clientHeight - this.ui.controls.clientHeight;
        this.ui.svgOverlay.style.top = this.ui.svgWrapper.style.top = this.ui.controls.clientHeight;
        this.ui.svgOverlay.style.width = this.ui.svgWrapper.style.width = this.ui.parentElement.clientWidth;
    }

    syncScroll(e)
    {
        var newTop = this.ui.svgWrapper.scrollTop = e.target.scrollTop;
        this.ui.svgWrapper.scrollLeft = this.ui.svgOverlay.scrollLeft;

        // If we're in vertical orientation, update this.currentSystem
        if (!this.verovioSettings.noLayout)
        {
            for (var idx = 0; idx < this.systemData.length; idx++)
            {
                if (newTop <= this.systemData[idx].topOffset + 25)
                {
                    this.currentSystem = idx;
                    break;
                }
            }
        }

        this.updateNavIcons();
    }

    gotoNextPage()
    {
        if (this.currentSystem < this.totalSystems - 1) this.scrollToPage(this.currentSystem + 1);
    }

    gotoPrevPage()
    {
        if (this.currentSystem > 0) this.scrollToPage(this.currentSystem - 1);
    }

    toggleOrientation() // TODO: this setting might not be right. IgnoreLayout instead?
    {
        var dirControls = this.ui.parentElement.getElementsByClassName("vida-direction-control");
        if(this.verovioSettings.noLayout === 1)
        {
            this.verovioSettings.noLayout = 0;
            for (var dIdx = 0; dIdx < dirControls.length; dIdx++)
                dirControls[dIdx].style['visibility'] = 'visible';
        }
        else
        {
            this.verovioSettings.noLayout = 1;
            for (var dIdx = 0; dIdx < dirControls.length; dIdx++)
                dirControls[dIdx].style['visibility'] = 'hidden';
        }

        this.refreshVerovio();
    }

    zoomIn()
    {
        if (this.verovioSettings.scale <= 100)
        {
            this.verovioSettings.scale += 10;
            this.refreshVerovio();
        }
        this.updateZoomIcons();
    }

    zoomOut()
    {
        if (this.verovioSettings.scale > 10)
        {
            this.verovioSettings.scale -= 10;
            this.refreshVerovio();
        }
        this.updateZoomIcons();
    }

    /**
     * Event listeners - Dragging
     */
    objectClickListener(e)
    {
        var closestMeasure = e.target.closest(".measure");
        if (closestMeasure) this.publish('ObjectClicked', [e.target, closestMeasure]);
        e.stopPropagation();
    }

    mouseDownListener(e)
    {
        var t = e.target;
        var id = t.parentNode.attributes.id.value;
        var sysID = t.closest('.system').attributes.id.value;

        for(var idx = 0; idx < this.systemData.length; idx++)
            if(this.systemData[idx].id == sysID)
            {
                this.clickedPage = idx;
                break;
            }

        this.resetHighlights();
        this.activateHighlight(id);

        var viewBoxSVG = t.closest("svg");
        var parentSVG = viewBoxSVG.parentNode.closest("svg");
        var actualSizeArr = viewBoxSVG.getAttribute("viewBox").split(" ");
        var actualHeight = parseInt(actualSizeArr[3]);
        var svgHeight = parseInt(parentSVG.getAttribute('height'));
        var pixPerPix = (actualHeight / svgHeight);

        this.dragInfo["x"] = t.getAttribute("x") >> 0;
        this.dragInfo["svgY"] = t.getAttribute("y") >> 0;
        this.dragInfo["initY"] = e.pageY;
        this.dragInfo["pixPerPix"] = pixPerPix;

        // we haven't started to drag yet, this might be just a selection
        document.addEventListener("mousemove", this.boundMouseMove);
        document.addEventListener("mouseup", this.boundMouseUp);
        document.addEventListener("touchmove", this.boundMouseMove);
        document.addEventListener("touchend", this.boundMouseUp);
        this.draggingActive = false;
    };

    mouseMoveListener(e)
    {
        const scaledY = (e.pageY - this.dragInfo.initY) * this.dragInfo.pixPerPix;
        for (var idx = 0; idx < this.highlightedCache.length; idx++)
            this.ui.svgOverlay.querySelector("#" + this.highlightedCache[idx]).setAttribute("transform", "translate(0, " + scaledY + ")");

        this.draggingActive = true;
        e.preventDefault();
    };

    mouseUpListener(e)
    {
        document.removeEventListener("mousemove", this.boundMouseMove);
        document.removeEventListener("mouseup", this.boundMouseUp);
        document.removeEventListener("touchmove", this.boundMouseMove);
        document.removeEventListener("touchend", this.boundMouseUp);

        if (!this.draggingActive) return;
        this.commitChanges(e.pageY);
    }

    commitChanges(finalY)
    {
        for (var idx = 0; idx < this.highlightedCache.length; idx++)
        {
            const id = this.highlightedCache[idx];
            const obj = this.ui.svgOverlay.querySelector("#" + id);
            const scaledY = this.dragInfo.svgY + (finalY - this.dragInfo.initY) * this.dragInfo.pixPerPix;
            obj.style["transform"] =  "translate(" + [0, scaledY] + ")";
            obj.style["fill"] = "#000";
            obj.style["stroke"] = "#000";

            const editorAction = JSON.stringify({
                action: 'drag',
                param: {
                    elementId: id,
                    x: parseInt(this.dragInfo.x),
                    y: parseInt(scaledY)
                }
            });

            this.contactWorker('edit', {'action': editorAction, 'pageIndex': this.clickedPage}, this.renderPage);
            if (this.draggingActive) this.removeHighlight(id);
        }

        if (this.draggingActive)
        {
            this.contactWorker("renderPage", {'pageIndex': this.clickedPage}, this.renderPage);
            this.draggingActive = false;
            this.dragInfo = {};
        }
    };

    activateHighlight(id)
    {
        if (this.highlightedCache.indexOf(id) > -1) return;

        this.highlightedCache.push(id);
        this.reapplyHighlights();

        // Hide the svgWrapper copy of the note
        this.ui.svgWrapper.querySelector("#" + id).setAttribute('style', "fill-opacity: 0.0; stroke-opacity: 0.0;");
    }

    reapplyHighlights()
    {
        for(var idx = 0; idx < this.highlightedCache.length; idx++)
        {
            var targetObj = this.ui.svgOverlay.querySelector("#" + this.highlightedCache[idx]);
            targetObj.setAttribute('style', "fill: #ff0000; stroke: #ff00000; fill-opacity: 1.0; stroke-opacity: 1.0;");
        }
    }

    removeHighlight(id)
    {
        var idx = this.highlightedCache.indexOf(id);
        if (idx === -1) return;

        var removedID = this.highlightedCache.splice(idx, 1);
        this.ui.svgWrapper.querySelector("#" + id).setAttribute('style', "fill-opacity: 1.0; stroke-opacity: 1.0;");
        this.ui.svgOverlay.querySelector("#" + removedID).setAttribute('style', "fill: #000000; stroke: #0000000; fill-opacity: 0.0; stroke-opacity: 0.0;");
    }

    resetHighlights()
    {
        while(this.highlightedCache[0]) this.removeHighlight(this.highlightedCache[0]);
    }
}

/**
*      Events. Pub/Sub system for Loosely Coupled logic.
*
*      Based on the Diva.js events system...
*      https://github.com/DDMAL/diva.js/blob/master/source/js/utils.js
*
*      ... which was in turn loosely based on Peter Higgins' port from Dojo to jQuery
*      https://github.com/phiggins42/bloody-jquery-plugins/blob/master/pubsub.js
*
*      Re-adapted to vanilla Javascript, then poorly adapted into ES6 for Vida6.
*/
class Events {
    constructor()
    {
        let cache = {};
        let argsCache = {};

        /**
         *      Events.publish
         *      e.g.: publish("ObjectClicked", [e.target, closestMeasure], this);
         *
         *      @class Events
         *      @method publish
         *      @param topic {String}
         *      @param args     {Array}
         *      @param scope {Object} Optional
         */
        this.publish = function (topic, args, scope)
        {
            if (cache[topic])
            {
                var thisTopic = cache[topic],
                    i = thisTopic.length;

                while (i--)
                    thisTopic[i].apply(scope || this, args || []);
            }
        };

        /**
         *      Events.subscribe
         *      e.g.: subscribe("ObjectClicked", (obj, measure) => {...})
         *
         *      @class Events
         *      @method subscribe
         *      @param topic {String}
         *      @param callback {Function}
         *      @return Event handler {Array}
         */
        this.subscribe = function (topic, callback)
        {
            if (!cache[topic])
                cache[topic] = [];

            cache[topic].push(callback);
            return [topic, callback];
        };

        /**
         *      Events.unsubscribe
         *      e.g.: var handle = subscribe("ObjectClicked", (obj, measure) => {...})
         *              unsubscribe(handle);
         *
         *      @class Events
         *      @method unsubscribe
         *      @param handle {Array}
         *      @param completely {Boolean} - Unsubscribe all events for a given topic.
         *      @return success {Boolean}
         */
        this.unsubscribe = function (handle, completely)
        {
            var t = handle[0];

            if (cache[t])
            {
                var i = cache[t].length;
                while (i--)
                {
                    if (cache[t][i] === handle[1])
                    {
                        cache[t].splice(i, 1);
                        if (completely)
                            delete cache[t];
                        return true;
                    }
                }
            }
            return false;
        };

        /**
         *      Events.unsubscribeAll
         *      e.g.: unsubscribeAll();
         *
         *      @class Events
         *      @method unsubscribe
         */
        this.unsubscribeAll = function ()
        {
            cache = {};
        };
    }
}
