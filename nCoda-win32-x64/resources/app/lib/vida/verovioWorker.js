/*
Incoming:
-setVerovio (verovioLocation)
-loadData (verovioOptions, dataToLoad)
-renderPage (pageIndex, initOverlay=true)
-edit (editorAction, pageIndex, initOverlay)
-mei

Outgoing:
-dataLoaded (pageCount)
-returnPage (pageIndex, svg, redoOverlay, mei)
-mei (mei)
*/

let vrvToolkit;
let vrvSet = false;

const contactCaller = function (message, ticket, params)
{
    postMessage([message, ticket, params]);
};

this.addEventListener('message', function (event){
    var rendered;
    var messageType = event.data[0];
    var ticket = event.data[1];
    var params = event.data[2];

    if (!vrvSet && messageType != "setVerovio") {
        contactCaller('error', ticket, {'error': "setVerovio must be called before the verovioWorker is used!"});
        console.error("setVerovio must be called before the verovioWorker is used!");
        return false;
    }

    switch (messageType)
    {
        case "setVerovio":
            importScripts(params.location);
            HateESLint = verovio.toolkit;
            vrvToolkit = new HateESLint();
            vrvSet = true;
            break;

        case "loadData":
            vrvToolkit.loadData(params.mei);
            contactCaller('dataLoaded', ticket, {'pageCount': vrvToolkit.getPageCount()});
            break;

        case "setOptions":
            vrvToolkit.setOptions(params.options);
            break;

        case "renderPage": // page index comes in 0-indexed and should be returned 0-indexed
            try {
                rendered = vrvToolkit.renderPage(params.pageIndex + 1);
            }
            catch (e) {
                contactCaller('error', ticket, {'error': "Render of page " + params.pageIndex + " failed:" + e});
            }
            contactCaller("returnPage", ticket, {'pageIndex': params.pageIndex, 'svg': rendered, 'createOverlay': true, 'mei': vrvToolkit.getMEI()});
            break;

        case "edit":
            var res = vrvToolkit.edit(params.action);
            try {
                rendered = vrvToolkit.renderPage(params.pageIndex + 1);
            }
            catch (e) {
                contactCaller('error', ticket, {'error': "Render of page " + params.pageIndex + " failed:" + e});
            }
            contactCaller("returnPage", ticket, {'pageIndex': params.pageIndex, 'svg': rendered, 'createOverlay': false, 'mei': vrvToolkit.getMEI()});
            break;

        case "mei":
            contactCaller("mei", ticket, {'mei': vrvToolkit.getMEI()});
            break;

        default:
            contactCaller('error', ticket, {'error': "Did not recognize input" + event.data});
            break;
    }
}, false);
