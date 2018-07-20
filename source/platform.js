var Noble, UUIDGen, Accessory, BluetoothAccessory;

module.exports = function (noble, uuidGen, accessory, bluetoothAccessory) {
  Noble = noble;
  UUIDGen = uuidGen
  Accessory = accessory;
  BluetoothAccessory = bluetoothAccessory;

  return BluetoothPlatform;
};


function BluetoothPlatform(log, config, homebridgeAPI) {
  this.log = log;

  if (!config) {
    this.log.warn("Missing mandatory platform config named 'Bluetooth'");
    return;
  }

  if (!config.accessories || !(config.accessories instanceof Array)) {
    this.log.warn("Missing mandatory config 'accessories'");
    return;
  }
  this.bluetoothAccessories = {};
  for (var accessoryConfig of config.accessories) {
    var accessoryAddress = trimAddress(accessoryConfig.address);
    var accessoryID = accessoryConfig.id;

    var bluetoothAccessory = new BluetoothAccessory(this.log, accessoryConfig);
    this.bluetoothAccessories[accessoryID] = bluetoothAccessory;
  }
  //this.cachedHomebridgeAccessories = {};

  this.homebridgeAPI = homebridgeAPI;
  this.homebridgeAPI.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}


BluetoothPlatform.prototype.configureAccessory = function (homebridgeAccessory) {
  var accessoryID = homebridgeAccessory.context['id'];
  var bluetoothAccessory = this.bluetoothAccessories[accessoryID];

  if (!bluetoothAccessory) {
    this.log.debug("Removed | " + homebridgeAccessory.displayName + " (" + accessoryID + ")");
    this.homebridgeAPI.unregisterPlatformAccessories("homebridge-bluetooth", "Bluetooth",
                                                     [homebridgeAccessory]);
    return;
  }

  this.log.debug("Persist | " + homebridgeAccessory.displayName + " (" + accessoryID + ")");
  //this.cachedHomebridgeAccessories[accessoryID] = homebridgeAccessory;
  bluetoothAccessory.homebridgeAccessory = homebridgeAccessory;
};


BluetoothPlatform.prototype.didFinishLaunching = function () {
  Noble.on('stateChange', this.stateChange.bind(this));
};


BluetoothPlatform.prototype.stateChange = function (state) {
  if (state != 'poweredOn') {
    this.log.info("Stopped | " + state);
    Noble.stopScanning();
  }

  this.log.info("Started | " + state);
  Noble.startScanning([], false);
  Noble.on('discover', this.discover.bind(this));
};


BluetoothPlatform.prototype.discover = function (nobleAccessory) {
  var accessoryAddress = trimAddress(nobleAccessory.address);

  var isMyDevice = false;

  for (var id of Object.keys(this.bluetoothAccessories)) {
    var bluetoothAccessory = this.bluetoothAccessories[id];
    if (bluetoothAccessory.address === accessoryAddress) {
      isMyDevice = true;
      break;
    }
  }

  if (!isMyDevice) {
    this.log.debug("Ignored | " + nobleAccessory.advertisement.localName +
                  " (" + nobleAccessory.address + ") | RSSI " + nobleAccessory.rssi + "dB");
    return;
  }

  this.log.debug("Discovered | " + nobleAccessory.advertisement.localName +
                " (" + nobleAccessory.address + ") | RSSI " + nobleAccessory.rssi + "dB");
  nobleAccessory.connect(function (error) {
    this.connect(error, nobleAccessory)
  }.bind(this));
};


BluetoothPlatform.prototype.connect = function (error, nobleAccessory) {
  if (error) {
    this.log.error("Connecting failed | " + nobleAccessory.advertisement.localName +
                   " (" + nobleAccessory.address + ") | " + error);
    return;
  }

  this.log.info("Connected | " + nobleAccessory.advertisement.localName + " (" + nobleAccessory.address + ")");

  for (var id of Object.keys(this.bluetoothAccessories)) {
    var bluetoothAccessory = this.bluetoothAccessories[id];

    if (!bluetoothAccessory.homebridgeAccessory) {
      var homebridgeAccessory = new Accessory(bluetoothAccessory.name,
                                          UUIDGen.generate(id));
      homebridgeAccessory.context['id'] = id;
      this.homebridgeAPI.registerPlatformAccessories("homebridge-bluetooth", "Bluetooth",
                                                     [homebridgeAccessory]);

      bluetoothAccessory.homebridgeAccessory = homebridgeAccessory;
    }

    bluetoothAccessory.homebridgeAccessory.on('identify', bluetoothAccessory.identification.bind(this));


  }

  nobleAccessory.once('disconnect', this.disconnect.bind(this));

  nobleAccessory.discoverServices([], this.discoverServices.bind(this));

};

BluetoothPlatform.prototype.disconnect = function (nobleAccessory, error ) {
  if (error) {
    this.log.error("Disconnecting failed | " + nobleAccessory.advertisement.localName + " (" + nobleAccessory.address + ") | " + error);
  }

  nobleAccessory.removeAllListeners();

  for (var id of Object.keys(this.bluetoothAccessories)) {
    var bluetoothAccessory = this.bluetoothAccessories[id];

    if (bluetoothAccessory) {
      bluetoothAccessory.homebridgeAccessory.removeAllListeners('identify');
    }

    for (var serviceUUID in bluetoothAccessory.bluetoothServices) {
      var bluetoothServices = bluetoothAccessory.bluetoothServices[serviceUUID];

      if (bluetoothServices) {
        for (var characteristicUUID in bluetoothServices.bluetoothCharacteristics) {
          bluetoothServices.bluetoothCharacteristics[characteristicUUID].disconnect();
        }
      }
    }
  }

  Noble.startScanning([], false);
};

BluetoothPlatform.prototype.discoverServices = function (error, nobleServices) {

  if (error) {
    this.log.error("Discover services failed | " + error);
    return;
  }
  if (nobleServices.length == 0) {
    this.log.warn("No services discovered");
    return;
  }

  for (var nobleService of nobleServices) {
    var serviceUUID = trimUUID(nobleService.uuid);
    var isMyService = false;

    for (var id of Object.keys(this.bluetoothAccessories)) {
      var bluetoothAccessory = this.bluetoothAccessories[id];

      var bluetoothService = bluetoothAccessory.bluetoothServices[serviceUUID];

      if (bluetoothService) {
        var homebridgeService = bluetoothAccessory.homebridgeAccessory.getService(bluetoothService.class);
        isMyService = true;

        if (!homebridgeService) {
          bluetoothAccessory.homebridgeAccessory.addService(bluetoothService.class, bluetoothService.name);
        }
      }
    }

    if (isMyService) {
      nobleService.discoverCharacteristics([], this.discoverCharacteristics.bind(this));
    }
  }
};

BluetoothPlatform.prototype.discoverCharacteristics = function (error, nobleCharacteristics) {
  if (error) {
    this.log.error("Discover characteristics failed | " + error);
    return;
  }

  if (nobleCharacteristics.length == 0) {
    this.log.warn("No characteristics discovered");
    return;
  }

  for (var nobleCharacteristic of nobleCharacteristics) {
    var characteristicUUID = trimUUID(nobleCharacteristic.uuid);

    for (var id of Object.keys(this.bluetoothAccessories)) {
      var bluetoothAccessory = this.bluetoothAccessories[id];

      for (var serviceUUID of Object.keys(bluetoothAccessory.bluetoothServices)) {
        var bluetoothServices = bluetoothAccessory.bluetoothServices[serviceUUID]
        var bluetoothCharacteristic = bluetoothServices.bluetoothCharacteristics[characteristicUUID];

        if (bluetoothCharacteristic) {
          var homebridgeCharacteristic = this.homebridgeService.getCharacteristic(bluetoothCharacteristic.class);
          bluetoothCharacteristic.connect(nobleCharacteristic, homebridgeCharacteristic);
        }
      }
    }
  }
};



// BluetoothPlatform.prototype.disconnect = function (nobleAccessory, error) {
//   //var accessoryAddress = trimAddress(nobleAccessory.address);
//   // this.cachedHomebridgeAccessories[accessoryAddress] = homebridgeAccessory;
//
//   Noble.startScanning([], false);
// };


function trimAddress(address) {
  return address.toLowerCase().replace(/:/g, "");
}

function trimUUID(uuid) {
  return uuid.toLowerCase().replace(/:/g, "").replace(/-/g, "");
}
