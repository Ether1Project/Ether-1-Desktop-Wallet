
(function () {
    var EventEmitter = window.EventEmitter;

    var postMessage = function(payload) {
        if(typeof payload === 'object') {
            payload = JSON.stringify(payload);
        }

        window.postMessage(payload, (!location.origin || location.origin === "null" ) ? '*' : location.origin);
    };


    // ETHEREUM PROVIDER

    // on events are: "connect", "data", "error", "end", "timeout"
    // "data" will get notifications

    function EthereumProvider() {
        var _this = this;
        // Call constructor of superclass to initialize superclass-derived members.
        EventEmitter.call(this);

        this.idCount = 1;
        this.responseCallbacks = {};

        // fire the connect
        this._connect();
        this._reconnectCheck();



        // Wait for response messages
        window.addEventListener('message', function(event) {
            var data;
            try {
                data = JSON.parse(event.data);
            } catch(e){
                data = event.data;
            }


            if(typeof data !== 'object' ||
               (data.message && (!Object.prototype.hasOwnProperty.call(data.message, 'jsonrpc') &&
                !Object.prototype.hasOwnProperty.call(data.message[0], 'jsonrpc')))) {
                return;
            }

            if (data.type === 'data' || data.type === 'error') {

                var id = null;
                var message = data.message;

                // if results object is Array from batch request
                if(typeof message === 'object' && message.forEach && isFinite(message.length)) {
                    message.forEach(function(load){
                        if(_this.responseCallbacks[load.id])
                            id = load.id;
                    });
                // if object is single request
                } else {
                    id = message.id;
                }

                // notification
                if(!id && message.method && message.method.indexOf('_subscription') !== -1) {
                    _this.emit('notification', message.result);

                // otherwise fire in the callback
                } else if(_this.responseCallbacks[id]) {

                    // batch results
                    if (data.type === 'error') {
                        _this.responseCallbacks[id](message);
                    } else if (message instanceof Array) {
                        var results = message;

                        // make sure batch results are returned in the right order
                        if (_this.responseCallbacks[id].batchIds) {
                            for (var i = 0; i < _this.responseCallbacks[id].batchIds.length; i++) {
                                results[i] = message.find(function (el) {
                                    return el.id === _this.responseCallbacks[id].batchIds[i];
                                 }) || results[i];

                            }
                        }


                        _this.responseCallbacks[id](null, message.map(function (res) {
                            var result = {};

                            if (res.result) {
                                result.result = res.result;
                            }
                            if (res.error) {
                                result.error = res.error;
                            }

                            return result;
                        }));

                    // single result
                    } else {
                        if (data.type === 'error') {
                            _this.responseCallbacks[id](message);
                        } else if (message.error) {
                            _this.responseCallbacks[id](message.error);
                        } else {
                            _this.responseCallbacks[id](null, message.result);
                        }
                    }

                    delete _this.responseCallbacks[id];
                }

            // make all other events listenable
            }
            // else if(data.type) {
            //     // TODO check if secure
            //     _this.emit('data.type', data.message);
            // }
        });
    }

    // inherit EventEmitter
    EthereumProvider.prototype = Object.create(EventEmitter.prototype);
    EthereumProvider.prototype.constructor = Web3Provider;


    /**
     Will watch for connection drops and tries to reconnect.

     @method _reconnectCheck
     */
    EthereumProvider.prototype._reconnectCheck = function() {
        var _this = this;
        var reconnectIntervalId;

        this.on('end', function () {
            reconnectIntervalId = setInterval(function () {
                _this._connect();
            }, 500);
        });

        this.on('connect', function () {
            clearInterval(reconnectIntervalId);
        });
    };


    /**
     Will try to make a connection

     @method connect
     */
    EthereumProvider.prototype._connect = function(payload, callback) {
        postMessage({
            type: 'create'
        });
    };

    /**
     Adds a callback to the responseCallbacks object,
     which will be called if a response matching the response Id will arrive.

     @method _addResponseCallback
     */
    EthereumProvider.prototype._addResponseCallback = function(payload, callback) {
        var id = payload.id || payload[0].id;
        var method = payload.method || payload[0].method;

        if (id && method) {
            this.responseCallbacks[id] = callback;
            this.responseCallbacks[id].method = method;

            if (payload instanceof Array) {
                this.responseCallbacks[id].batchIds = payload.map(function (pyld) {
                    return pyld.id;
                });
            }
        }
    };


    /**
     Sends the request

     @method send
     @param {String} methodName     The name of the method to call
     @param {Array} parameters      The parameters in an array
     @param {Function} callback the callback to call
     */
    EthereumProvider.prototype.send = function send(methodName, parameters, callback) {
        parameters = parameters || [];

        if (!methodName || typeof methodName !== 'string') {
            throw new Error('Given method name: "'+ methodName +'" is not a valid string.');
        }

        if (!(parameters instanceof Array)) {
            throw new Error('Given parameters are not a valid parameter array.');
        }

        if (typeof callback !== 'function') {
            throw new Error('No callback given, sync calls are not possible anymore in Mist. Please use only async calls.');
        }

        var payload = {
            id: this.idCount++,
            jsonrpc: '2.0',
            method: methodName,
            params: parameters
        };

        this._addResponseCallback(payload, callback);

        postMessage({
            type: 'write',
            message: payload
        }, this.origin);
    };

    /**
     Sends batch requests

     @method sendBatch
     @param {array} requests     Array with requests in the following format {method: 'eth_example', parameters: [1, 2]}
     @param {Function} callback the callback to call
     */
    EthereumProvider.prototype.sendBatch = function send(requests, callback) {
        var payloads = [];

        if (!(requests instanceof Array)) {
            throw new Error('Given requests parameter is not an array.');
        }

        for (var i = 0; i < requests.length; i++) {
            requests[i].parameters = requests[i].parameters || [];

            if (!requests[i].method || typeof requests[i].method !== 'string') {
                throw new Error('Given method name: "'+ requests[i].method +'" is not a valid string.');
            }

            if (!(requests[i].parameters instanceof Array)) {
                throw new Error('Given parameters are not a valid parameter array.');
            }

            payloads.push({
                id: this.idCount++,
                jsonrpc: '2.0',
                method: requests[i].method,
                params: requests[i].parameters
            });
        }


        this._addResponseCallback(payloads, callback);

        postMessage({
            type: 'write',
            message: payloads
        }, this.origin);
    };




    // DEPRECATED
    // WEB3 PROVIDER

    // on events are: "connect", "data", "error", "end", "timeout"
    // "data" will get notifications

    function Web3Provider() {
        var _this = this;
        // Call constructor of superclass to initialize superclass-derived members.
        EventEmitter.call(this);

        this.responseCallbacks = {};

        // fire the connect
        this._connect();
        this._reconnectCheck();



        // Wait for response messages
        window.addEventListener('message', function(event) {
            var data;
            try {
                data = JSON.parse(event.data);
            } catch(e){
                data = event.data;
            }


            if(typeof data !== 'object' || (data.message && (!Object.prototype.hasOwnProperty.call(data.message, 'jsonrpc') && !Object.prototype.hasOwnProperty.call(data.message[0], 'jsonrpc')))) {
                return;
            }

            if (data.type === 'data') {

                var id = null;
                var result = data.message;

                // get the id which matches the returned id
                if(typeof result === 'object' && result.forEach && isFinite(result.length)) {
                    result.forEach(function(load){
                        if(_this.responseCallbacks[load.id])
                            id = load.id;
                    });
                } else {
                    id = result.id;
                }

                // notification
                if(!id && result.method && result.method.indexOf('_subscription') !== -1) {
                    // _this.listeners('data').forEach(function(callback){
                    //     if(typeof callback === 'function')
                    //         callback(null, result);
                    // });
                    _this.emit('data', result);

                // fire the callback
                } else if(_this.responseCallbacks[id]) {
                    _this.responseCallbacks[id](null, result);
                    delete _this.responseCallbacks[id];
                }

            // make all other events listenable
            } else if(data.type) {
                // _this.listeners(data.type).forEach(function(callback){
                //     if(typeof callback === 'function')
                //         callback(null, data.message);
                // });
                // TODO check if secure
                _this.emit('data.type', data.message);
            }
        });
    }

    Web3Provider.prototype = Object.create(EventEmitter.prototype);
    Web3Provider.prototype.constructor = Web3Provider;

    /**
     Get the adds a callback to the responseCallbacks object,
     which will be called if a response matching the response Id will arrive.

     @method _addResponseCallback
     */
    Web3Provider.prototype._addResponseCallback = function(payload, callback) {
        var id = payload.id || payload[0].id;
        var method = payload.method || payload[0].method;

        if (typeof callback !== 'function') {
           throw new Error('No callback given, sync calls are not possible anymore in Mist. Please use only async calls.');
        }

        this.responseCallbacks[id] = callback;
        this.responseCallbacks[id].method = method;
    };


    /**
     Will watch for connection drops and tries to reconnect.

     @method _reconnectCheck
     */
    Web3Provider.prototype._reconnectCheck = function() {
        var _this = this;
        var reconnectIntervalId;

        this.on('end', function () {
            reconnectIntervalId = setInterval(function () {
                _this._connect();
            }, 500);
        });

        this.on('connect', function () {
            clearInterval(reconnectIntervalId);
        });
    };



    /**
     Will try to make a connection

     @method connect
     */
    Web3Provider.prototype._connect = function(payload, callback) {
        postMessage({
            type: 'create'
        });
    };

    /**
     Sends the request

     @method send
     @param {Object} payload    example: {id: 1, jsonrpc: '2.0', 'method': 'eth_someMethod', params: []}
     @param {Function} callback the callback to call
     */
    // TODO transform to: send(method, params, callback)
    Web3Provider.prototype.send = function send(payload, callback) {

        this._addResponseCallback(payload, callback);
        postMessage({
            type: 'write',
            message: payload
        }, this.origin);
    };




    // expose ETHEREUM PROVIDER


    delete window.EventEmitter;
    window.ethereum = new EthereumProvider();


    // expose WEB3 PROVIDER

    // For backwards compatibility of web3.currentProvider;
    Web3Provider.prototype.sendSync = function () {
        return {jsonrpc: '2.0', error: {"code": -32603, message: 'Sync calls are not anymore supported in Mist :\\'}};
    };
    Web3Provider.prototype.sendAsync = Web3Provider.prototype.send;
    Web3Provider.prototype.isConnected = function () {
        return true;
    };
    window.web3 = {
        currentProvider: new Web3Provider()
    };
})();
