import { PassProps } from "passkit-generator";

function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
    return value !== null && value !== undefined;
}

const secrets = globalThis as any;

export const pass: (barcode: string, locations?: string[], name?: string) => PassProps = (barcode, locations, name) => ({
    "formatVersion": 1,
    "passTypeIdentifier": secrets.PASS_TYPE_IDENTIFIER,
    "teamIdentifier": secrets.TEAM_IDENTIFIER,
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
                "value": "Version 1.1.0"
            }
        ].filter(notEmpty),
        "secondaryFields": [
            {
                "key": "header10",
                "label": "parkrun ID number",
                "value": barcode,
            },
            ...(name ? [{
                "key": "header10",
                "label": "runner name",
                "value": name,
            }] : [])
        ],
        "auxiliaryFields": [],
    }
})