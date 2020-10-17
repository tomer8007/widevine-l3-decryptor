/**
 * Hooks EME calls and forwards them for analysis and decryption.
 * 
 * Most of the code here was borrowed from https://github.com/google/eme_logger/blob/master/eme_listeners.js
 */

 var lastReceivedLicenseRequest = null;
 var lastReceivedLicenseResponse = null;

 /** Set up the EME listeners. */
function startEMEInterception() 
{
  var listener = new EmeInterception();
  listener.setUpListeners();
}

 /**
 * Gets called whenever an EME method is getting called or an EME event fires
 */
EmeInterception.onOperation = function(operationType, args) 
{
    if (operationType == "GenerateRequestCall")
    {
       // got initData
       // console.log(args);
    }
    else if (operationType == "MessageEvent")
    {
        var licenseRequest = args.message;
        lastReceivedLicenseRequest = licenseRequest;
    }
    else if (operationType == "UpdateCall")
    {
        var licenseResponse = args[0];
        lastReceivedLicenseResponse = licenseResponse;

        // OK, let's try to decrypt it, assuming the response correlates to the request
        WidevineCrypto.decryptContentKey(lastReceivedLicenseRequest, lastReceivedLicenseResponse);
    }
};


/**
 * Manager for EME event and method listeners.
 * @constructor
 */
function EmeInterception() 
{
  this.unprefixedEmeEnabled = Navigator.prototype.requestMediaKeySystemAccess ? true : false;
  this.prefixedEmeEnabled = HTMLMediaElement.prototype.webkitGenerateKeyRequest ? true : false;
}


/**
 * The number of types of HTML Media Elements to track.
 * @const {number}
 */
EmeInterception.NUM_MEDIA_ELEMENT_TYPES = 3;


/**
 * Sets up EME listeners for whichever type of EME is enabled.
 */
EmeInterception.prototype.setUpListeners = function() 
{
  if (!this.unprefixedEmeEnabled && !this.prefixedEmeEnabled) {
    // EME is not enabled, just ignore
    return;
  }
  if (this.unprefixedEmeEnabled) {
    this.addListenersToNavigator_();
  }
  if (this.prefixedEmeEnabled) {
    // Prefixed EME is enabled
  }
  this.addListenersToAllEmeElements_();
};


/**
 * Adds listeners to the EME methods on the Navigator object.
 * @private
 */
EmeInterception.prototype.addListenersToNavigator_ = function() 
{
  if (navigator.listenersAdded_) 
    return;

  var originalRequestMediaKeySystemAccessFn = EmeInterception.extendEmeMethod(
      navigator,
      navigator.requestMediaKeySystemAccess,
      "RequestMediaKeySystemAccessCall");

  navigator.requestMediaKeySystemAccess = function() 
  {
    var options = arguments[1];

    // slice "It is recommended that a robustness level be specified" warning
    var modifiedArguments = arguments;
    var modifiedOptions = EmeInterception.addRobustnessLevelIfNeeded(options);
    modifiedArguments[1] = modifiedOptions;

    var result = originalRequestMediaKeySystemAccessFn.apply(null, modifiedArguments);
    // Attach listeners to returned MediaKeySystemAccess object
    return result.then(function(mediaKeySystemAccess) 
    {
      this.addListenersToMediaKeySystemAccess_(mediaKeySystemAccess);
      return Promise.resolve(mediaKeySystemAccess);
    }.bind(this));

  }.bind(this);

  navigator.listenersAdded_ = true;
};


/**
 * Adds listeners to the EME methods on a MediaKeySystemAccess object.
 * @param {MediaKeySystemAccess} mediaKeySystemAccess A MediaKeySystemAccess
 *     object to add listeners to.
 * @private
 */
EmeInterception.prototype.addListenersToMediaKeySystemAccess_ = function(mediaKeySystemAccess) 
{
  if (mediaKeySystemAccess.listenersAdded_) {
    return;
  }
  mediaKeySystemAccess.originalGetConfiguration = mediaKeySystemAccess.getConfiguration;
  mediaKeySystemAccess.getConfiguration = EmeInterception.extendEmeMethod(
      mediaKeySystemAccess,
      mediaKeySystemAccess.getConfiguration,
      "GetConfigurationCall");

  var originalCreateMediaKeysFn = EmeInterception.extendEmeMethod(
      mediaKeySystemAccess,
      mediaKeySystemAccess.createMediaKeys,
      "CreateMediaKeysCall");

  mediaKeySystemAccess.createMediaKeys = function() 
  {
    var result = originalCreateMediaKeysFn.apply(null, arguments);
    // Attach listeners to returned MediaKeys object
    return result.then(function(mediaKeys) {
      mediaKeys.keySystem_ = mediaKeySystemAccess.keySystem;
      this.addListenersToMediaKeys_(mediaKeys);
      return Promise.resolve(mediaKeys);
    }.bind(this));

  }.bind(this);

  mediaKeySystemAccess.listenersAdded_ = true;
};


/**
 * Adds listeners to the EME methods on a MediaKeys object.
 * @param {MediaKeys} mediaKeys A MediaKeys object to add listeners to.
 * @private
 */
EmeInterception.prototype.addListenersToMediaKeys_ = function(mediaKeys) 
{
  if (mediaKeys.listenersAdded_) {
    return;
  }
  var originalCreateSessionFn = EmeInterception.extendEmeMethod(mediaKeys, mediaKeys.createSession, "CreateSessionCall");
  mediaKeys.createSession = function() 
  {
    var result = originalCreateSessionFn.apply(null, arguments);
    result.keySystem_ = mediaKeys.keySystem_;
    // Attach listeners to returned MediaKeySession object
    this.addListenersToMediaKeySession_(result);
    return result;
  }.bind(this);

  mediaKeys.setServerCertificate = EmeInterception.extendEmeMethod(mediaKeys, mediaKeys.setServerCertificate, "SetServerCertificateCall");
  mediaKeys.listenersAdded_ = true;
};


/** Adds listeners to the EME methods and events on a MediaKeySession object.
 * @param {MediaKeySession} session A MediaKeySession object to add
 *     listeners to.
 * @private
 */
EmeInterception.prototype.addListenersToMediaKeySession_ = function(session) 
{
  if (session.listenersAdded_) {
    return;
  }

  session.generateRequest = EmeInterception.extendEmeMethod(session,session.generateRequest, "GenerateRequestCall");
  session.load = EmeInterception.extendEmeMethod(session, session.load, "LoadCall");
  session.update = EmeInterception.extendEmeMethod(session,session.update, "UpdateCall");
  session.close = EmeInterception.extendEmeMethod(session, session.close, "CloseCall");
  session.remove = EmeInterception.extendEmeMethod(session, session.remove, "RemoveCall");

  session.addEventListener('message', function(e) 
  {
    e.keySystem = session.keySystem_;
    EmeInterception.interceptEvent("MessageEvent", e);
  });

  session.addEventListener('keystatuseschange', EmeInterception.interceptEvent.bind(null, "KeyStatusesChangeEvent"));

  session.listenersAdded_ = true;
};


/**
 * Adds listeners to all currently created media elements (audio, video) and sets up a
 * mutation-summary observer to add listeners to any newly created media
 * elements.
 * @private
 */
EmeInterception.prototype.addListenersToAllEmeElements_ = function() 
{
  this.addEmeInterceptionToInitialMediaElements_();

  // TODO: Use MutationObserver directry
  // var observer = new MutationSummary({
  //   callback: function(summaries) {
  //     applyListeners(summaries);
  //   },
  //   queries: [{element: 'video'}, {element: 'audio'}, {element: 'media'}]
  // });

  // var applyListeners = function(summaries) {
  //   for (var i = 0; i < EmeInterception.NUM_MEDIA_ELEMENT_TYPES; i++) {
  //     var elements = summaries[i];
  //     elements.added.forEach(function(element) {
  //       this.addListenersToEmeElement_(element, true);
  //     }.bind(this));
  //   }
  // }.bind(this);
};


/**
 * Adds listeners to the EME elements currently in the document.
 * @private
 */
EmeInterception.prototype.addEmeInterceptionToInitialMediaElements_ = function() 
{
  var audioElements = document.getElementsByTagName('audio');
  for (var i = 0; i < audioElements.length; ++i) {
    this.addListenersToEmeElement_(audioElements[i], false);
  }
  var videoElements = document.getElementsByTagName('video');
  for (var i = 0; i < videoElements.length; ++i) {
    this.addListenersToEmeElement_(videoElements[i], false);
  }
  var mediaElements = document.getElementsByTagName('media');
  for (var i = 0; i < mediaElements.length; ++i) {
    this.addListenersToEmeElement_(mediaElements[i], false);
  }
};


/**
 * Adds method and event listeners to media element.
 * @param {HTMLMediaElement} element A HTMLMedia element to add listeners to.
 * @private
 */
EmeInterception.prototype.addListenersToEmeElement_ = function(element) 
{
  this.addEmeEventListeners_(element);
  this.addEmeMethodListeners_(element);
  console.info('EME listeners successfully added to:', element);
};


/**
 * Adds event listeners to a media element.
 * @param {HTMLMediaElement} element A HTMLMedia element to add listeners to.
 * @private
 */
EmeInterception.prototype.addEmeEventListeners_ = function(element) 
{
  if (element.eventListenersAdded_) {
    return;
  }

  if (this.prefixedEmeEnabled) 
  {
    element.addEventListener('webkitneedkey', EmeInterception.interceptEvent.bind(null, "NeedKeyEvent"));
    element.addEventListener('webkitkeymessage', EmeInterception.interceptEvent.bind(null, "KeyMessageEvent"));
    element.addEventListener('webkitkeyadded', EmeInterception.interceptEvent.bind(null, "KeyAddedEvent"));
    element.addEventListener('webkitkeyerror', EmeInterception.interceptEvent.bind(null, "KeyErrorEvent"));
  }

  element.addEventListener('encrypted', EmeInterception.interceptEvent.bind(null, "EncryptedEvent"));
  element.addEventListener('play', EmeInterception.interceptEvent.bind(null, "PlayEvent"));

  element.addEventListener('error', function(e) {
    console.error('Error Event');
    EmeInterception.interceptEvent("ErrorEvent", e);
  });

  element.eventListenersAdded_ = true;
};


/**
 * Adds method listeners to a media element.
 * @param {HTMLMediaElement} element A HTMLMedia element to add listeners to.
 * @private
 */
EmeInterception.prototype.addEmeMethodListeners_ = function(element) 
{
  if (element.methodListenersAdded_) {
    return;
  }

  element.play = EmeInterception.extendEmeMethod(element, element.play, "PlayCall");

  if (this.prefixedEmeEnabled) {
    element.canPlayType = EmeInterception.extendEmeMethod(element, element.canPlayType, "CanPlayTypeCall");

    element.webkitGenerateKeyRequest = EmeInterception.extendEmeMethod(element, element.webkitGenerateKeyRequest, "GenerateKeyRequestCall");
    element.webkitAddKey = EmeInterception.extendEmeMethod(element, element.webkitAddKey, "AddKeyCall");
    element.webkitCancelKeyRequest = EmeInterception.extendEmeMethod(element, element.webkitCancelKeyRequest, "CancelKeyRequestCall");

  }

  if (this.unprefixedEmeEnabled) {
    element.setMediaKeys = EmeInterception.extendEmeMethod(element, element.setMediaKeys, "SetMediaKeysCall");
  }

  element.methodListenersAdded_ = true;
};


/**
 * Creates a wrapper function that logs calls to the given method.
 * @param {!Object} element An element or object whose function
 *    call will be logged.
 * @param {!Function} originalFn The function to log.
 * @param {!Function} type The constructor for a logger class that will
 *    be instantiated to log the originalFn call.
 * @return {!Function} The new version, with logging, of orginalFn.
 */
EmeInterception.extendEmeMethod = function(element, originalFn, type) 
{
  return function() 
  {
    try
    {
        var result = originalFn.apply(element, arguments);
        var args = [].slice.call(arguments);
        EmeInterception.interceptCall(type, args, result, element);
    }
    catch (e)
    {
      console.error(e);
    }
    

    return result;
  };
};


/**
 * Intercepts a method call to the console and a separate frame.
 * @param {!Function} constructor The constructor for a logger class that will
 *    be instantiated to log this call.
 * @param {Array} args The arguments this call was made with.
 * @param {Object} result The result of this method call.
 * @param {!Object} target The element this method was called on.
 * @return {!eme.EmeMethodCall} The data that has been logged.
 */
EmeInterception.interceptCall = function(type, args, result, target) 
{
  EmeInterception.onOperation(type, args);
  return args;
};

/**
 * Intercepts an event to the console and a separate frame.
 * @param {!Function} constructor The constructor for a logger class that will
 *    be instantiated to log this event.
 * @param {!Event} event An EME event.
 * @return {!eme.EmeEvent} The data that has been logged.
 */
EmeInterception.interceptEvent = function(type, event) 
{
  EmeInterception.onOperation(type, event);
  return event;
};

EmeInterception.addRobustnessLevelIfNeeded = function(options)
{
  for (var i = 0; i < options.length; i++)
  {
    var option = options[i];
    var videoCapabilities = option["videoCapabilities"];
    var audioCapabilties = option["audioCapabilities"];
    if (videoCapabilities != null)
    {
      for (var j = 0; j < videoCapabilities.length; j++)
        if (videoCapabilities[j]["robustness"] == undefined) videoCapabilities[j]["robustness"] = "SW_SECURE_CRYPTO";
    }

    if (audioCapabilties != null)
    {
      for (var j = 0; j < audioCapabilties.length; j++)
        if (audioCapabilties[j]["robustness"] == undefined) audioCapabilties[j]["robustness"] = "SW_SECURE_CRYPTO";
    }
    
    option["videoCapabilities"] = videoCapabilities;
    option["audioCapabilities"] = audioCapabilties;
    options[i] = option;
  }

  return options;
}

startEMEInterception();
