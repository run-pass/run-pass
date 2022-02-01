
import * as React from "react";
import { useState } from "react";
import { Button, Col, Container, Form, FormControl, InputGroup, NavLink, Row } from "react-bootstrap";
import { parkRunLocationData } from "../../../cloudflare-worker/src/assets/park_runs";
import * as haversine from "haversine"

export interface PassbookLocation {
    relevantText?: string;
    altitude?: number;
    latitude: number;
    longitude: number;
}


export function App() {
    const [parkRunId, setParkRunId] = useState("");
    const [locationsWithProximity, setLocationsWithProximity] = useState(undefined);
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [currentIndex, setCurrentIndex] = useState("0");
    const [isLoadingProximities, setIsLoadingProximities] = useState(false);

    const locations = locationsWithProximity || parkRunLocationData.sort((a, b) => (a.properties.EventShortName > b.properties.EventShortName ? 1 : -1));

    const addProximity = async () => {
        try {
            const currentPos: GeolocationPosition = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
            return parkRunLocationData
                .map(pr => ({ ...pr, proximity: haversine({ longitude: currentPos.coords.longitude, latitude: currentPos.coords.latitude }, { longitude: pr.geometry.coordinates[0], latitude: pr.geometry.coordinates[1] }) }))
                .sort((a, b) => a.proximity - b.proximity)
        } catch (e) {
            alert(`Couldn't get location: ${e?.message}`)
        }
    }

    const getLocationsWithProximity = async () => {
        if (locationsWithProximity) {
            return locationsWithProximity
        }

        setIsLoadingProximities(true);

        const locs = await addProximity();

        setLocationsWithProximity(locs);

        setIsLoadingProximities(false);

        return locs
    }

    const setToTop10 = async (seriesId: number) => {
        const locs = await getLocationsWithProximity();

        setSelectedLocations(locs.filter(loc => loc.properties.seriesid === seriesId).slice(0, 10))
    }

    const setToTop10Adult = setToTop10.bind(null, 1)

    const setToTop10Junior = setToTop10.bind(null, 2)

    const removeSelected = (removeAtIndex) => setSelectedLocations(selectedLocations.filter((e, i) => i !== removeAtIndex));

    const addSelected = (newCurrentIndex) => {
        setCurrentIndex(newCurrentIndex);

        if (!selectedLocations.includes(locations[newCurrentIndex])) {
            setSelectedLocations([...selectedLocations, locations[newCurrentIndex]])
        }
    };

    const goToPass = () => {
        const locations: string = selectedLocations.map(d => d.properties.eventname).join("&locations=");

        window.location.href = `https://api.getrunpass.com/passbook?barcode=A${parkRunId}` + (locations ? `&locations=${locations}` : "")
    }

    return (
        <div className="App">
            <Container>
                <Row style={{ marginBottom: "10px", marginTop: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <h2>🏃 getrunpass.com</h2>
                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        parkrun now <a target="_blank" href="https://blog.parkrun.com/uk/2021/11/22/scanning-from-mobile-devices/">accepts digital barcodes</a>. This app allows you to create a pass for your iPhone that has your parkrun barcode on it. If you have an issues or feedback, please <a target="_blank" href="https://github.com/run-pass/run-pass.github.io/issues/new">create an issue on github</a> or <a target="_blank" href="mailto:billy.trend@gmail.com">send me an email</a>.
                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <b>Required step:</b> Please enter your parkrun ID number. This is the number that appears after the letter "A" below your barcode. If you can't find it, parkrun has <a target="_blank" href="https://support.parkrun.com/hc/en-us/articles/200566243-What-is-my-parkrun-ID-number-">instructions</a>.
                    </Col>
                </Row>
                <Row>
                    <Col sm={{ span: 12 }}>
                        <InputGroup  className="mb-3">
                            <InputGroup.Text id="basic-addon1">A-</InputGroup.Text>
                            <FormControl
                                value={parkRunId}
                                onChange={(e) => setParkRunId(e.target.value.replace(/\D/g,''))}
                                placeholder="parkrun ID (omit the A)"
                                aria-label="parkrun ID"
                                aria-describedby="basic-addon1"
                                inputMode="numeric"
                            />

                        </InputGroup>

                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <b>Optional step:</b> Passbook allows you to set up to 10 relevant locations which will cause the pass to show up on your homescreen when you are near that location. If you would like this functionality please add up to 10 parkruns to your pass.
                    </Col>
                </Row>
                {
                    navigator.geolocation && <Row style={{ marginBottom: "10px" }}>
                        <Col sm={{ span: 12 }}>
                            <Button onClick={setToTop10Adult} variant="outline-secondary">Use my 10 closest adult parkruns</Button>
                        </Col>
                    </Row>
                }
                {
                    navigator.geolocation && <Row style={{ marginBottom: "10px" }}>
                        <Col sm={{ span: 12 }}>
                            <Button onClick={setToTop10Junior} variant="outline-secondary">Use my 10 closest junior parkruns</Button>
                        </Col>
                    </Row>
                }
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <div style={{ display: "flex", flexDirection: "row", gridGap: "10px" }}>
                            <Form.Select disabled={selectedLocations.length >= 10} value={currentIndex} placeholder="Select a parkrun to add" onChange={(e) => addSelected(e.target.value)} aria-label="Default select example">
                                {locations.map((pr, i) => <option id={i} value={i}>{pr.properties.EventShortName}</option>)}
                            </Form.Select>
                        </div>
                    </Col>
                </Row>
                {isLoadingProximities && <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        Calculating distances...
                    </Col>
                </Row>}
                {selectedLocations.map((selected, i) => <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <div style={{ display: "flex", flexDirection: "row", gridGap: "10px", justifyContent: "space-between" }}>{selected.properties.EventShortName}
                            <Button onClick={removeSelected.bind(null, i)} variant="outline-danger">Remove</Button></div>
                    </Col>
                </Row>)}
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <Button
                            disabled={isLoadingProximities || !parkRunId}
                            variant="success"
                            onClick={goToPass}>Generate Pass</Button>
                    </Col>
                </Row>
            </Container >

        </div >
    );
}
