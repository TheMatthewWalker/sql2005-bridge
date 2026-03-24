import express from 'express';
import sql from 'mssql';
import axios from 'axios';
import { sqlConfig } from '../server.js';

const router = express.Router();
const getPool = async () => await sql.connect(sqlConfig);

// ── Validate required KN env vars on startup ──────────────────────────────────
const KN_API_URL      = process.env.KN_API_URL;
const KN_CUSTOMER_ID  = process.env.KN_CUSTOMER_ID;
const KN_CUSTOMER_KEY = process.env.KN_CUSTOMER_KEY;

if (!KN_API_URL || !KN_CUSTOMER_ID || !KN_CUSTOMER_KEY) {
    console.error('[freightbooking] Missing required env vars: KN_API_URL, KN_CUSTOMER_ID, KN_CUSTOMER_KEY');
}

// ── Build KN booking payload from DB records ──────────────────────────────────
function buildBookingPayload(shipment, pallets) {
    const cargoItems = pallets.map(p => ({
        description:     p.palletType   || 'Pallet',
        marksAndNumbers: String(p.palletID),
        stackable:       false,
        packageCount:    1,
        packageType:     'PLT',
        weight:          Number(p.grossWeight)   || 0,
        weightUom:       'KGM',
        volume:          Number(p.palletVolume)  || 0,
        volumeUom:       'MTQ',
        dimensionLength: Number(p.palletLength)  || 0,
        dimensionWidth:  Number(p.palletWidth)   || 0,
        dimensionHeight: Number(p.palletHeight)  || 0,
        dimensionsUom:   'MMT',
    }));

    const pickupDate = shipment.plannedCollection
        ? new Date(shipment.plannedCollection).toISOString().split('T')[0]
        : null;

    return {
        customerId:  KN_CUSTOMER_ID,
        customerKey: KN_CUSTOMER_KEY,

        bookingFlags: {
            appointmentRequired: false,
            tailLiftRequired:    false,
            highValue:           false,
            oversizedGoods:      false,
            privateConsignee:    false,
            insurance:           false,
        },

        bookingOptions: [],

        dangerousGoodsPackageCount: 0,

        incoterm: {
            code:     shipment.incoTerms || '',
            location: '',
        },

        shipperParty: {
            address: {
                name1:       shipment.originName        || '',
                street1:     shipment.originStreet      || '',
                city:        shipment.originCity        || '',
                postalCode:  shipment.originPostCode    || '',
                countryCode: shipment.originCountry     || '',
            },
        },

        consigneeParty: {
            address: {
                name1:       shipment.destinationName        || '',
                street1:     shipment.destinationStreet      || '',
                city:        shipment.destinationCity        || '',
                postalCode:  shipment.destinationPostCode    || '',
                countryCode: shipment.destinationCountry     || '',
            },
        },

        pickupLocation: {
            address: {
                name1:       shipment.originName        || '',
                street1:     shipment.originStreet      || '',
                city:        shipment.originCity        || '',
                postalCode:  shipment.originPostCode    || '',
                countryCode: shipment.originCountry     || '',
            },
            requestDate: pickupDate,
        },

        deliveryLocation: {
            address: {
                name1:       shipment.destinationName        || '',
                street1:     shipment.destinationStreet      || '',
                city:        shipment.destinationCity        || '',
                postalCode:  shipment.destinationPostCode    || '',
                countryCode: shipment.destinationCountry     || '',
            },
        },

        cargoItems,
    };
}

// ── POST /api/freight-booking/shipment/:shipmentId ────────────────────────────
// Creates a KN freight booking for the given shipment, using ShipmentMain as
// the header and all linked PalletMain records as cargoItems.
router.post('/shipment/:shipmentId', async (req, res) => {
    if (!KN_API_URL || !KN_CUSTOMER_ID || !KN_CUSTOMER_KEY) {
        return res.status(503).json({ error: 'Freight booking is not configured. Check KN_API_URL, KN_CUSTOMER_ID, KN_CUSTOMER_KEY in .env.' });
    }

    const shipmentId = req.params.shipmentId;

    let shipment, pallets;

    try {
        const pool = await getPool();

        // Fetch shipment header
        const shipmentResult = await pool.request()
            .input('shipmentId', sql.BigInt, shipmentId)
            .query('SELECT * FROM dbo.ShipmentMain WHERE shipmentID = @shipmentId');

        if (shipmentResult.recordset.length === 0) {
            return res.status(404).json({ error: `Shipment ${shipmentId} not found.` });
        }
        shipment = shipmentResult.recordset[0];

        // Fetch all pallets linked to this shipment via ShipmentLink → DeliveryLink → PalletMain
        const palletsResult = await pool.request()
            .input('shipmentId', sql.BigInt, shipmentId)
            .query(`
                SELECT pm.*
                FROM dbo.PalletMain pm
                INNER JOIN dbo.DeliveryLink dl ON dl.palletID = pm.palletID
                INNER JOIN dbo.ShipmentLink sl ON sl.deliveryID = dl.deliveryID
                WHERE sl.shipmentID = @shipmentId
            `);

        pallets = palletsResult.recordset;

        if (pallets.length === 0) {
            return res.status(422).json({ error: `No pallets found linked to shipment ${shipmentId}.` });
        }

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }

    const payload = buildBookingPayload(shipment, pallets);

    try {
        const knResponse = await axios.post(KN_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Accept':       'application/json',
            },
            timeout: 30000,
        });

        return res.status(201).json({
            message:    'Booking created successfully',
            shipmentID: Number(shipmentId),
            booking:    knResponse.data,
        });

    } catch (err) {
        if (err.response) {
            // KN API returned an error response
            return res.status(err.response.status).json({
                error:      'KN API returned an error',
                knStatus:   err.response.status,
                knResponse: err.response.data,
            });
        }
        // Network / timeout error
        return res.status(502).json({ error: `Could not reach KN API: ${err.message}` });
    }
});

export default router;
