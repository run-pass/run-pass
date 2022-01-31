import { Injectable } from '@nestjs/common';
import { Location, PKPass } from "passkit-generator";
import { Stream } from 'stream';
import * as fs from "fs"
import { resolve } from 'path';
import * as crypto from "crypto";
import { parkRunLocationData } from 'src/assets/park_runs';
import { pass } from './assets/pass';


const wwdr = fs.readFileSync(resolve("src/assets/wwdr.pem"));
const signerCert = process.env.SIGNER_CERT;
const signerKey = process.env.SIGNER_KEY;
const signerKeyPassphrase = process.env.SIGNER_KEY_PASSPHRASE;

const icon = fs.readFileSync(("src/assets/icon.png"));

const locationMapping = Object.fromEntries(parkRunLocationData.map(d => [d.properties.eventname, d]))

@Injectable()
export class AppService {
  async getPassbook(barcode: string, locations: string[]): Promise<Stream> {
    try {
      const passObj = new PKPass({
        "pass.json": Buffer.from(JSON.stringify(pass(barcode, locations)), "utf-8"),
        "icon.png": icon,
        "thumbnail": icon,
      },
        {
          wwdr,
          signerCert,
          signerKey,
          signerKeyPassphrase,
        }, {
        serialNumber: crypto.randomBytes(10).toString('hex')
      });

      passObj.setLocations(...locations
        .map(locId => locationMapping[locId])
        .map(location => ({
          longitude: location.geometry.coordinates[0],
          latitude: location.geometry.coordinates[1],
          relevantText: location.properties.EventLongName
        })))
      passObj.setBarcodes({ "format": "PKBarcodeFormatCode128", "message": barcode, "messageEncoding": "iso-8859-1", altText: barcode }); // Random value
      // Generate the stream .pkpass file stream
      return passObj.getAsStream();
    } catch (err) {
      throw (err);
    }
  }
}
