import { PassProps } from "passkit-generator";

export const pass: (barcode: string, locations?: string[]) => PassProps = (barcode, locations) => ({
    "formatVersion": 1,
    "passTypeIdentifier": "pass.com.runpass",
    "teamIdentifier": "29C784RGJ8",
    "organizationName": "getrunpass.com",
    "description": "Pass for your parkrun barcode",
    "backgroundColor": "rgb(73, 93, 78)",
    "foregroundColor": "rgb(255,255,255)",
    "generic": {
        "primaryFields": [
            {
                "key": "primary",
                "label": "",
                "value": "getrunpass.com 🏃",
            }
        ],
        "headerFields": [
            {
                "key": "header",
                "label": "getrunpass.com",
                "value": "parkrun barcode",
            }
        ],
        "backFields": [
            {
                "key": "1",
                "label": "",
                dataDetectorTypes: ["PKDataDetectorTypeLink"],
                "value": "If you have issues with the pass, please create an issue or send a contribution on github https://api.getrunpass.com/github or drop me an email at billy.trend@gmail.com"
            },
            {
                "key": "2",
                "label": "",
                dataDetectorTypes: ["PKDataDetectorTypeLink"],
                "value": "Thanks for using runpass! A newer version of the pass may be available so head over to https://getrunpass.com to ensure you have the most up-to-date version."
            },
            locations && locations.length > 0 ? {
                "key": "3",
                "label": "",
                "value": `Local parkruns: ${locations.join(", ")}`
            } : null,
            {
                "key": "4",
                "label": "",
                "value": "Version 1.0.0"
            }
        ].filter(f => f),
        "secondaryFields": [
            {
                "key": "header9",
                "label": "parkrun ID number",
                "value": barcode,
            }
        ],
        "auxiliaryFields": [],
    }
})