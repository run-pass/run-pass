import "./darkmode.css";
import * as React from "react";
import { useState, useEffect } from "react";
import { Button, Col, Container, Form, FormControl, InputGroup, NavLink, Row } from "react-bootstrap";
import * as haversine from "haversine"
import Select from "react-select";
import { components } from "react-select";
 interface PassbookLocation {
    relevantText?: string;
    altitude?: number;
    latitude: number;
    longitude: number;
}
import events from "../assets/events.json";

export function App() {
    const [parkRunId, setParkRunId] = useState("");
    const [name, setName] = useState("");
    const [locationsWithProximity, setLocationsWithProximity] = useState(undefined);
    const [selectedLocations, setSelectedLocations] = useState([]);
    const [currentIndex, setCurrentIndex] = useState("0");
    const [isLoadingLocations, setIsLoadingLocations] = useState(false);
    const [remoteLocations, setRemoteLocations] = useState(undefined);

    useEffect(() => {
        async function fetchLocations() {
            setIsLoadingLocations(true);
            try {
                const res = await fetch("https://prod-api.getrunpass.com/events.json");
                if (!res.ok) throw new Error("Failed to fetch remote events.json");
                const data = await res.json();
                // Use data.events.features if present, else fallback
                if (data && data.events && Array.isArray(data.events.features)) {
                    setRemoteLocations(data.events.features);
                } else {
                    throw new Error("Unexpected events.json format");
                }
            } catch (e) {
                setRemoteLocations(events.events.features);
                console.error("Error fetching remote locations, falling back to local asset:", e);
            } finally {
                setIsLoadingLocations(false);
            }
        }
        fetchLocations();
    }, []);

    // Use remoteLocations only; do not fallback to local asset
    const locations = locationsWithProximity || (remoteLocations ? remoteLocations.sort((a, b) => (a.properties.EventShortName > b.properties.EventShortName ? 1 : -1)) : []);

    const addProximity = async () => {
        try {
            const currentPos: GeolocationPosition = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
            if (!remoteLocations) return [];
            return remoteLocations
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

        setIsLoadingLocations(true);

        const locs = await addProximity();

        setLocationsWithProximity(locs);

        setIsLoadingLocations(false);

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
        console.log(`https://prod-api.getrunpass.com/passbook?barcode=A${parkRunId}` + (name ? `&name=${name}` : "") + (locations ? `&locations=${locations}` : ""))
        window.location.href = `https://prod-api.getrunpass.com/passbook?barcode=A${parkRunId}` + (name ? `&name=${name}` : "") + (locations ? `&locations=${locations}` : "")
    }

    // Custom styles for react-select to support dark mode
    const selectStyles = {
        control: (provided, state) => ({
            ...provided,
            backgroundColor: state.isFocused ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#181a1b' : '#fff') : (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#181a1b' : '#fff'),
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
            borderColor: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#444' : '#ccc',
            boxShadow: state.isFocused ? '0 0 0 2px #2563eb' : provided.boxShadow,
        }),
        menu: (provided) => ({
            ...provided,
            backgroundColor: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#23272a' : '#fff',
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
        }),
        option: (provided, state) => ({
            ...provided,
            backgroundColor: state.isSelected
                ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#2563eb' : '#e0e7ff')
                : state.isFocused
                    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#2d3748' : '#f3f4f6')
                    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? '#23272a' : '#fff'),
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
        }),
        multiValue: (provided) => ({
            ...provided,
            backgroundColor: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#2d3748' : '#e5e7eb',
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
        }),
        multiValueLabel: (provided) => ({
            ...provided,
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
        }),
        multiValueRemove: (provided) => ({
            ...provided,
            color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222',
            ':hover': {
                backgroundColor: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#444' : '#cbd5e1',
                color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#fff' : '#222',
            },
        }),
    };

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
                        parkrun now <a target="_blank" href="https://blog.parkrun.com/uk/2021/11/22/scanning-from-mobile-devices/">accepts digital barcodes</a>. This app allows you to create a pass for your iPhone that has your parkrun barcode on it. If you have an issues or feedback, please <a target="_blank" href="https://github.com/run-pass/run-pass/issues/new">create an issue on github</a> or <a target="_blank" href="mailto:billy.trend@gmail.com">send me an email</a>.
                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <b>Required step:</b> please enter your parkrun ID number. This is the number that appears after the letter "A" below your barcode. If you can't find it, parkrun has <a target="_blank" href="https://support.parkrun.com/hc/en-us/articles/205632182-2-1-How-do-I-access-my-parkrun-profile">instructions</a>.
                    </Col>
                </Row>
                <Row>
                    <Col sm={{ span: 12 }}>
                        <InputGroup className="mb-3">
                            <InputGroup.Text id="basic-addon1">A-</InputGroup.Text>
                            <FormControl
                                value={parkRunId}
                                onChange={(e) => setParkRunId(e.target.value.replace(/\D/g, ''))}
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
                        <b>Optional step:</b> you may enter a name to be shown on the pass. Useful if you need to store multiple passes on one phone.
                    </Col>
                </Row>
                <Row>
                    <Col sm={{ span: 12 }}>
                        <InputGroup className="mb-3">
                            <FormControl
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Name"
                                aria-label="name"
                                aria-describedby="basic-addon1"
                            />

                        </InputGroup>

                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <b>Optional step:</b> passbook allows you to set up to 10 relevant locations which will cause the pass to show up on your homescreen when you are near that location. If you would like this functionality please add up to 10 parkruns to your pass.
                    </Col>
                </Row>
                {navigator.geolocation && (
                    <Row style={{ marginBottom: "10px" }}>
                        <Col sm={{ span: 12 }}>
                            <div style={{ display: "flex", flexDirection: "row", gap: "10px", width: "100%" }}>
                                <Button onClick={setToTop10Adult} variant="outline-secondary">Use my 10 closest adult parkruns</Button>
                                <Button onClick={setToTop10Junior} variant="outline-secondary">Use my 10 closest junior parkruns</Button>
                                <Button onClick={async () => {
                                    setIsLoadingLocations(true);
                                    const locs = await addProximity();
                                    setLocationsWithProximity(locs);
                                    setIsLoadingLocations(false);
                                }} variant="outline-secondary">Sort by nearest</Button>
                            </div>
                        </Col>
                    </Row>
                )}
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <div style={{ display: "flex", flexDirection: "row", gap: "10px", width: "100%", alignItems: "stretch" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Select
                                    isMulti
                                    options={locations.map((pr, i) => ({ value: i, label: pr.properties.EventShortName }))}
                                    value={selectedLocations.map(sel => {
                                        const idx = locations.findIndex(l => l === sel);
                                        return { value: idx, label: sel.properties.EventShortName };
                                    })}
                                    onChange={opts => {
                                        const indices = (opts || []).map(opt => opt.value).slice(0, 10);
                                        setSelectedLocations(indices.map(i => locations[i]));
                                    }}
                                    closeMenuOnSelect={false}
                                    isOptionDisabled={() => selectedLocations.length >= 10}
                                    placeholder="Select up to 10 parkruns..."
                                    aria-label="Select parkruns"
                                    maxMenuHeight={300}
                                    styles={{
                                        ...selectStyles,
                                        container: (provided) => ({ ...provided, width: "100%" }),
                                        loadingMessage: (provided) => ({ ...provided, color: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#d0d0d0' : '#222' })
                                    }}
                                    isLoading={isLoadingLocations}
                                />
                            </div>
                        </div>
                    </Col>
                </Row>
                <Row style={{ marginBottom: "10px" }}>
                    <Col sm={{ span: 12 }}>
                        <Button
                            disabled={isLoadingLocations || !parkRunId}
                            variant="success"
                            onClick={goToPass}>Generate Pass</Button>
                    </Col>
                </Row>
            </Container >

        </div >
    );
}
