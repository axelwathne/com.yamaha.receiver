'use strict';

const axios = require('axios');
const xml2js = require('xml2js');
const SurroundProgramEnum = require('./enums/SurroundProgramEnum');
const InputEnum = require('./enums/InputEnum');
const Entities = new (require('html-entities').XmlEntities)();

class YamahaReceiverClient {

    constructor(ipAddress) {
        this.ipAddress = ipAddress;
        this.inputs = Object.values(InputEnum);
        this.surroundPrograms = Object.values(SurroundProgramEnum);
        this.state = {
            input: {},
            surround: {},
            sound: {},
        };
        this._onSuccess = null;
        this._onError = null;
    }

    setSurroundProgram(surroundProgram) {
        console.log('set surround', surroundProgram);

        if (!this.validateSurroundProgram(surroundProgram)) {
            throw new Error('Invalid surround program "' + surroundProgram + '"');
        }

        return this.put(this.getMainZone(), '<Surround><Program_Sel><Current><Straight>Off</Straight><Sound_Program>' + surroundProgram + '</Sound_Program></Current></Program_Sel></Surround>');
    }

    setSurroundStraight(straight) {
        let straightState = straight === true ? 'On' : 'Off';

        return this.put(this.getMainZone(), '<Surround><Program_Sel><Current><Straight>' + straightState + '</Straight></Current></Program_Sel></Surround>');
    }

    setSurroundEnhancer(enhancer) {
        let enhancerState = enhancer === true ? 'On' : 'Off';

        return this.put(this.getMainZone(), '<Surround><Program_Sel><Current><Enhancer>' + enhancerState + '</Enhancer></Current></Program_Sel></Surround>');
    }

    setSoundDirect(direct) {
        let directState = direct === true ? 'On' : 'Off';

        return this.put(this.getMainZone(), '<Sound_Video><Direct><Mode>' + directState + '</Mode></Direct></Sound_Video>');
    }

    setSoundExtraBass(extraBass) {
        let extraBassState = extraBass === true ? 'Auto' : 'Off';

        return this.put(this.getMainZone(), '<Sound_Video><Extra_Bass>' + extraBassState + '</Extra_Bass></Sound_Video>');
    }

    setSoundAdaptiveDRC(adaptiveDRC) {
        let adaptiveDRCState = adaptiveDRC === true ? 'On' : 'Off';

        return this.put(this.getMainZone(), '<Sound_Video><Adaptive_DRC>' + adaptiveDRCState + '</Adaptive_DRC></Sound_Video>');
    }

    setLine(line) {
        return this.put(this.getMainZone(), '<List_Control><Direct_Sel>Line_' + line + '</Direct_Sel></List_Control>');
    }

    setInput(input) {
        if (!this.validateInput(input)) {
            throw new Error('Invalid source "' + input + '"');
        }

        return this.put(this.getMainZone(), '<Input><Input_Sel>' + input + '</Input_Sel></Input>');
    }

    setMuted(muted) {
        let mutedState = muted === true ? 'On' : 'Off';

        return this.put('<Volume><Mute>' + mutedState + '</Mute></Volume>');
    }

    setPower(power) {
        let powerState = power === true ? 'On' : 'Standby';

        return this.put(this.getMainZone(), '<Power_Control><Power>' + powerState + '</Power></Power_Control>');
    }

    setVolume(volume) {
        let dbVolume = this.percentileToDecibel(volume);
        return this.put(this.getMainZone(), `<Volume><Lvl><Val>${dbVolume}</Val><Exp>1</Exp><Unit>dB</Unit></Lvl></Volume>`).then(response => {
            console.log('setVolume response', response);
        });
    }

    getZone() {
        return new Promise((resolve, reject) => {
            if (typeof this.state.input.selected === "undefined") {
                this.getState().then(state => {
                    resolve(this.getZoneByInput(state.input.selected));
                }).catch(reject);
            } else {
                resolve(this.getZoneByInput(this.state.input.selected));
            }
        });
    }

    play() {
        return this.putPlayControlPlayback('Play');
    }

    pause() {
        return this.putPlayControlPlayback('Pause');
    }

    next() {
        return this.putPlayControlPlayback('Skip Fwd');
    }

    previous() {
        return this.putPlayControlPlayback('Skip Rev');
    }

    putPlayControlPlayback(value) {
        return this.getZone().then(zone => {
            return this.put(this.getMainZone(), '<Play_Control><Playback>' + value + '</Playback></Play_Control>');
        });
    }

    getPlayInfo() {
        let playInfo = {
            available: false,
            playing: false,
            artist: null,
            album: null,
            track: null,
        };

        return this.getZone().then(zone => {
            if (this.hasPlayInfo(zone)) {
                return this.get(zone, '<Play_Info>GetParam</Play_Info>').then(xmlResponse => {
                    return xml2js.parseStringPromise(xmlResponse)
                        .then(result => {
                            let playInfoResult = result['YAMAHA_AV'][zone][0]['Play_Info'][0],
                                availabilityResult = playInfoResult['Feature_Availability'][0],
                                playbackInfoResult = playInfoResult['Playback_Info'][0],
                                metaInfoResult = playInfoResult['Meta_Info'][0];

                            playInfo.available = availabilityResult === 'Ready';
                            playInfo.playing = playbackInfoResult === 'Play';
                            playInfo.artist = Entities.decode(metaInfoResult['Artist'][0]);
                            playInfo.album = Entities.decode(metaInfoResult['Album'][0]);
                            playInfo.track = Entities.decode(metaInfoResult['Song'][0]);

                            return playInfo;
                        });
                });
            } else {
                return playInfo;
            }
        });
    }

    hasPlayInfo(zone) {
        let supportedZones = [
            this.getUSBZone(),
            this.getIPodUSBZone(),
            this.getSpotifyZone(),
            this.getNetRadioZone(),
            this.getServerZone(),
            this.getJukeZone(),
            this.getTunerZone(),
            this.getAirPlayZone(),
        ];

        return supportedZones.indexOf(zone) !== -1;
    }

    getState() {
        return this.request('GET', this.getMainZone(), '<Basic_Status>GetParam</Basic_Status>')
            .then(xmlResponse => {
                return xml2js.parseStringPromise(xmlResponse)
                    .then(result => {
                        let statusResult = result['YAMAHA_AV']['Main_Zone'][0]['Basic_Status'][0],
                            powerResult = statusResult['Power_Control'][0],
                            volumeResult = statusResult['Volume'][0],
                            inputResult = statusResult['Input'][0],
                            surroundResult = statusResult['Surround'][0],
                            currentSurroundResult = surroundResult['Program_Sel'][0]['Current'][0],
                            soundVideoResult = statusResult['Sound_Video'][0],
                            state = {
                                volume: {},
                                input: {},
                                surround: {},
                                sound: {},
                            };

                        state.power = powerResult['Power'][0] === 'On';
                        state.volume.current = this.decibelToPercentile(parseInt(volumeResult['Lvl'][0]['Val'][0]));
                        state.volume.muted = volumeResult['Mute'][0] === 'On';
                        state.volume.subwooferTrim = volumeResult['Subwoofer_Trim'][0]['Val'][0];
                        state.volume.displayScale = volumeResult['Lvl'][0]['Unit'][0];
                        state.input.selected = inputResult['Input_Sel'][0];
                        state.input.title = inputResult['Input_Sel_Item_Info'][0]['Title'][0];
                        state.surround.program = currentSurroundResult['Sound_Program'][0];
                        state.surround.straight = currentSurroundResult['Straight'][0] === 'On';
                        state.surround.enhancer = currentSurroundResult['Enhancer'][0] === 'On';
                        state.sound.direct = soundVideoResult['Pure_Direct'][0]['Mode'][0] === 'On';
                        state.sound.extraBass = soundVideoResult['Extra_Bass'][0] !== 'Off';
                        state.sound.adaptiveDynamicRangeControl = soundVideoResult['Adaptive_DRC'][0] !== 'Off';

                        this.state = state;

                        return state;
                    });
            });
    }

    get(zone, body) {
        return this.request('GET', zone, body);
    }

    put(zone, body) {
        return this.request('PUT', zone, body);
    }

    request(method, zone, body) {
        body = '<YAMAHA_AV cmd="' + method + '"><' + zone + '>' + body + '</' + zone + '></YAMAHA_AV>';

        let result = axios
            .post('http://' + this.ipAddress + '/YamahaRemoteControl/ctrl', body)
            .then(data => data.data);
        // .then(data => {
        //     // TODO throw error if <YAMAHA_AV RC="3">
        // });

        if (typeof this._onSuccess === "function") {
            result.then(this._onSuccess);
        }

        if (typeof this._onError === "function") {
            result.catch(this._onError);
        }

        return result;
    }

    validateInput(source) {
        return this.inputs.indexOf(source) > -1;
    }

    validateSurroundProgram(surroundProgram) {
        return this.surroundPrograms.indexOf(surroundProgram) > -1;
    }

    percentileToDecibel(percentile) {
        let max = 970,
            offset = 805,
            stepSize = 5,
            decibelVolume = parseInt((max * (percentile / 100)) - offset),
            diff = decibelVolume % stepSize;

        if (diff < (stepSize / 2)) {
            return parseInt(decibelVolume - diff);
        } else {
            return parseInt(decibelVolume + (stepSize - diff));
        }
    }

    decibelToPercentile(decibel) {
        let max = 970,
            offset = 805;

        return parseFloat(((decibel + offset) / (max / 100)).toPrecision(4));
    }

    onSuccess(callback) {
        this._onSuccess = callback;
    }

    onError(callback) {
        this._onError = callback;
    }

    getSystemZone() {
        return 'System';
    }

    getMainZone() {
        return 'Main_Zone';
    }

    getTunerZone() {
        return 'Tuner';
    }

    getAirPlayZone() {
        return 'AirPlay';
    }

    getSpotifyZone() {
        return 'Spotify';
    }

    getIPodUSBZone() {
        return 'iPod_USB';
    }

    getUSBZone() {
        return 'USB';
    }

    getNetRadioZone() {
        return 'NET_RADIO';
    }

    getServerZone() {
        return 'SERVER';
    }

    getJukeZone() {
        return 'Juke';
    }

    getZoneByInput(input) {
        let supportedInputs = {
            'HDMI1': this.getMainZone(),
            'HDMI2': this.getMainZone(),
            'HDMI3': this.getMainZone(),
            'HDMI4': this.getMainZone(),
            'HDMI5': this.getMainZone(),
            'HDMI6': this.getMainZone(),
            'HDMI7': this.getMainZone(),
            'HDMI8': this.getMainZone(),
            'AV1': this.getMainZone(),
            'AV2': this.getMainZone(),
            'AV3': this.getMainZone(),
            'AV4': this.getMainZone(),
            'AV5': this.getMainZone(),
            'AV6': this.getMainZone(),
            'AUDIO1': this.getMainZone(),
            'AUDIO2': this.getMainZone(),
            'AUDIO3': this.getMainZone(),
            'TUNER': this.getTunerZone(),
            'AirPlay': this.getAirPlayZone(),
            'Spotify': this.getSpotifyZone(),
            'IPOD_USB': this.getIPodUSBZone(),
            'USB': this.getUSBZone(),
            'NET_RADIO': this.getNetRadioZone(),
        };

        if (typeof supportedInputs[input] === "undefined") {
            throw new Error('Could not find zone by input [' + input + ']')
        }

        return supportedInputs[input];
    }
}

module.exports = YamahaReceiverClient;