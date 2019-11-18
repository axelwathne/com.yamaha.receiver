"use strict";

const Homey = require('homey');
const YamahaReceiverClient = require('../../lib/YamahaReceiver/YamahaReceiverClient');
const SurroundProgramEnum = require('../../lib/YamahaReceiver/enums/SurroundProgramEnum');
const InputEnum = require('../../lib/YamahaReceiver/enums/InputEnum');

const CAPABILITIES_SET_DEBOUNCE = 100;
const MINIMUM_UPDATE_INTERVAL = 5000;
const UNAVAILABLE_UPDATE_INTERVAL = 60000;

class YamahaReceiverDevice extends Homey.Device {

    onInit() {
        this._data = this.getData();
        this._settings = this.getSettings();

        this.deviceLog('registering listeners');
        this.registerListeners();

        this.deviceLog('registering flow card conditions');
        this.registerFlowCards();

        this.setAvailable().catch(this.error);

        this.ready(() => {
            this.deviceLog('initializing monitor');
            this.runMonitor();
            this.deviceLog('initialized');
        });
    }

    registerListeners() {
        this._onCapabilitiesSet = this._onCapabilitiesSet.bind(this);

        this.registerCapabilityListener('onoff', value => {
            return this.getClient().setPower(value).catch(this.error);
        });
        this.registerCapabilityListener('volume_set', value => {
            return this.getClient().setVolume(value * 100).catch(this.error);
        });
        this.registerCapabilityListener('volume_mute', value => {
            return this.getClient().setMuted(value).then(() => {
                if (value) {
                    this.mutedTrigger.trigger(this).then(this.log).catch(this.error);
                } else {
                    this.unmutedTrigger.trigger(this).then(this.log).catch(this.error);
                }
            }).catch(this.error);
        });
        this.registerCapabilityListener('input_selected', value => {
            return this.getClient().setInput(value).then(() => {
                this.inputChangedTrigger.trigger(this, {
                    input: {
                        id: value
                    }
                }).then(this.log).catch(this.error)
            }).catch(this.error);
        });
        this.registerCapabilityListener('surround_program', value => {
            return this.getClient().setSurroundProgram(value).then(() => {
                // TODO: this doesn't work fro some reason
                this.surroundProgramChangedTrigger.trigger(this, {
                    surround_program: {
                        id: value
                    }
                }).then(this.log).catch(this.error)
            }).catch(this.error);
        })
        this.registerCapabilityListener('surround_straight', value => {
            return this.getClient().setSurroundStraight(value).catch(this.error);
        });
        this.registerCapabilityListener('surround_enhancer', value => {
            return this.getClient().setSurroundEnhancer(value).catch(this.error);
        });
        this.registerCapabilityListener('sound_direct', value => {
            return this.getClient().setSoundDirect(value).catch(this.error);
        });
        this.registerCapabilityListener('sound_extra_bass', value => {
            return this.getClient().setSoundExtraBass(value).catch(this.error);
        });
        this.registerCapabilityListener('sound_adaptive_drc', value => {
            return this.getClient().setSoundAdaptiveDRC(value).catch(this.error);
        });
        this.registerCapabilityListener('speaker_playing', value => {
            return value
                ? this.getClient().play().catch(this.error)
                : this.getClient().pause().catch(this.error);
        });
        this.registerCapabilityListener('speaker_next', value => {
            return this.getClient().next().then(() => {
                return this.updateDevice();
            }).catch(this.error);
        });
        this.registerCapabilityListener('speaker_prev', value => {
            return this.getClient().previous().then(() => {
                return this.updateDevice();
            }).catch(this.error);
        });
    }

    registerFlowCards() {
        this.inputChangedTrigger = new Homey.FlowCardTrigger('input_changed')
            .register();
        this.surroundProgramChangedTrigger = new Homey.FlowCardTrigger('surround_program_changed')
            .register();
        this.mutedTrigger = new Homey.FlowCardTrigger('muted')
            .register();
        this.unmutedTrigger = new Homey.FlowCardTrigger('unmuted')
            .register();

        this.changeInputAction = new Homey.FlowCardAction('change_input')
            .register();
        this.changeInputAction
            .registerRunListener((args, state) => {
                return this.getClient().setInput(args.input.id).catch(this.error);
            });
        this.changeInputAction
            .getArgument('input')
            .registerAutocompleteListener((query, args) => {
                return Promise.resolve(
                    Object.values(InputEnum).map(value => {
                        return {
                            id: value,
                            name: value
                        };
                    })
                );
            });

        this.changeSurroundProgramAction = new Homey.FlowCardAction('change_surround_program')
            .register();
        this.changeSurroundProgramAction
            .registerRunListener((args, state) => {
                return this.getClient().setSurroundProgram(args.surround_program.id).catch(this.error);
            });
        this.changeSurroundProgramAction
            .getArgument('surround_program')
            .registerAutocompleteListener((query, args) => {
                return Promise.resolve(
                    Object.values(SurroundProgramEnum).map(value => {
                        return {
                            id: value,
                            name: value
                        };
                    })
                );
            });
    }

    runMonitor() {
        setTimeout(() => {
            this.updateDevice()
                .then(() => {
                    this.runMonitor();
                })
                .catch(() => {
                    this.runMonitor();
                });
        }, this.getUpdateInterval());
    }

    getUpdateInterval() {
        if (!this.getAvailable()) {
            return UNAVAILABLE_UPDATE_INTERVAL;
        }

        let updateInterval = (this._settings.updateInterval * 1000);

        if (updateInterval < MINIMUM_UPDATE_INTERVAL) {
            return MINIMUM_UPDATE_INTERVAL;
        }

        return updateInterval;
    }

    getIPAddress() {
        return this._settings.ipAddress;
    }

    getZone() {
        return this._settings.zone;
    }

    updateDevice(resolve, reject) {
        return Promise.all([
            this.getClient().getState().then((receiverState) => {
                this.syncReceiverStateToCapabilities(receiverState);

                this.deviceLog('monitor updated device values');

                if (!this.getAvailable()) {
                    this.setAvailable().catch(this.error)
                }
            }).catch(error => {
                this.deviceLog('monitor failed updating device values', error.code);

                if (this.getAvailable()) {
                    this.setCapabilityValue('onoff', false).catch(this.error);
                    this.setUnavailable().catch(this.error);
                }
            }),
            this.getClient().getPlayInfo().then(playInfo => {
                this.syncReceiverPlayIntoToCapabilities(playInfo);
            }).catch(this.error)
        ]);
    }

    _onCapabilitiesSet(valueObj, optsObj) {
        console.log(valueObj, optsObj);

        return true;
    }

    onClientSuccess(error) {
        // We got a success so the device is available, check if we need to re-enable it
    }

    deviceLog(...message) {
        this.log('Yamaha Device [' + this._data.id + ']', ...message);
    }

    /**
     * @returns YamahaReceiverClient
     */
    getClient() {
        if (typeof this._yamahaReceiverClient === "undefined" || this._yamahaReceiverClient === null) {
            this._yamahaReceiverClient = new YamahaReceiverClient(this.getIPAddress(), this.getZone());
            // this._yamahaReceiverClient.onSuccess(this.onClientSuccess.bind(this));
        }

        return this._yamahaReceiverClient;
    }

    syncReceiverStateToCapabilities(state) {
        this.setCapabilityValue('onoff', state.power).catch(this.error);
        this.setCapabilityValue('volume_set', state.volume.current / 100).catch(this.error);
        this.setCapabilityValue('volume_mute', state.volume.muted).catch(this.error);
        this.setCapabilityValue('input_selected', state.input.selected).catch(this.error);
        this.setCapabilityValue('surround_program', state.surround.program).catch(this.error);
        this.setCapabilityValue('surround_straight', state.surround.straight).catch(this.error);
        this.setCapabilityValue('surround_enhancer', state.surround.straight).catch(this.error);
        this.setCapabilityValue('sound_direct', state.surround.straight).catch(this.error);
        this.setCapabilityValue('sound_extra_bass', state.surround.straight).catch(this.error);
        this.setCapabilityValue('sound_adaptive_drc', state.surround.straight).catch(this.error);
    }

    syncReceiverPlayIntoToCapabilities(playInfo) {
        this.setCapabilityValue('speaker_playing', playInfo.playing).catch(this.error);
        this.setCapabilityValue('speaker_track', playInfo.track).catch(this.error);
        this.setCapabilityValue('speaker_album', playInfo.album).catch(this.error);
        this.setCapabilityValue('speaker_artist', playInfo.artist).catch(this.error);
    }
}

module.exports = YamahaReceiverDevice;