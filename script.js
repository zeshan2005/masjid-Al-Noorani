document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration & State ---
    let currentTimings = null;
    let countdownInterval = null;
    let map = null;
    let marker = null;

    // --- Navbar Scroll Effect ---
    const navbar = document.querySelector('.navbar');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(10, 17, 24, 0.95)';
            navbar.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        } else {
            navbar.style.background = 'rgba(10, 17, 24, 0.8)';
            navbar.style.boxShadow = 'none';
        }
    });

    // --- Dynamic Prayer Times & Location ---
    const gregorianDateEl = document.getElementById('gregorian-date');
    const hijriDateEl = document.getElementById('hijri-date');
    const locationStatusEl = document.getElementById('location-status');
    const locationInput = document.getElementById('location-input');
    const searchBtn = document.getElementById('search-location-btn');
    const errorEl = document.getElementById('location-error');

    const gregorianOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

    // --- Time Math Helpers ---
    function timeToMins(aladhanTimeStr) {
        // Aladhan times are like "05:30 (CDT)", strip the timezone.
        const timeClean = aladhanTimeStr.split(' ')[0];
        const [hours, minutes] = timeClean.split(':').map(Number);
        return (hours * 60) + minutes;
    }

    function addMinutesToTime(timeStr, mins) {
        const totalMins = timeToMins(timeStr);
        const date = new Date();
        date.setHours(Math.floor(totalMins / 60), (totalMins % 60) + mins);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function formatTime12h(timeStr) {
        const totalMins = timeToMins(timeStr);
        const date = new Date();
        date.setHours(Math.floor(totalMins / 60), totalMins % 60);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    // Fetch prayer times using EXACT coordinates (bypasses Aladhan's unreliable geocoder)
    async function fetchPrayerTimes(lat, lon, label, isDefault = false) {
        try {
            errorEl.style.display = 'none';
            searchBtn.disabled = true;
            searchBtn.textContent = 'Loading...';

            // Use Aladhan coordinate-based endpoint for pin-point accuracy
            // Method 2 = ISNA, standard for North America
            const today = new Date();
            const dateStr = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
            const response = await fetch(
                `https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lon}&method=2`
            );
            const data = await response.json();

            if (data.code !== 200) {
                throw new Error('Could not retrieve prayer times');
            }

            const timings = data.data.timings;
            const dateInfo = data.data.date;

            // Update Dates
            gregorianDateEl.textContent = today.toLocaleDateString('en-US', gregorianOptions);
            hijriDateEl.textContent = `${dateInfo.hijri.month.en} ${dateInfo.hijri.day}, ${dateInfo.hijri.year}`;

            // Update Prayer Times
            const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
            prayers.forEach(prayer => {
                const lower = prayer.toLowerCase();
                const time24h = timings[prayer];

                const timeElement = document.getElementById(`${lower}-time`);
                const iqamahElement = document.getElementById(`${lower}-iqamah`);

                if (timeElement) timeElement.textContent = formatTime12h(time24h);
                if (iqamahElement) {
                    const iqamahOffset = lower === 'maghrib' ? 5 : 15;
                    iqamahElement.textContent = addMinutesToTime(time24h, iqamahOffset);
                }
            });

            // Update Location Status
            if (isDefault) {
                locationStatusEl.textContent = "📍 Default: Masjid's Location";
                locationStatusEl.classList.remove('custom-location');
            } else {
                locationStatusEl.textContent = `📍 ${label}`;
                locationStatusEl.classList.add('custom-location');
            }

            // Update map with the EXACT coordinates we used (always accurate)
            if (!isDefault && map) {
                map.flyTo({ center: [lon, lat], zoom: 14, speed: 1.4 });
                if (marker) {
                    marker.setLngLat([lon, lat]);
                } else {
                    marker = new maplibregl.Marker({ color: '#c9a84c' })
                        .setLngLat([lon, lat])
                        .addTo(map);
                }
            }

            // Update Live Countdown Data
            currentTimings = timings;
            startPrayerCountdown();
            highlightNextPrayer(timings);

        } catch (error) {
            console.error('Error fetching prayer times:', error);
            errorEl.style.display = 'block';
            errorEl.textContent = isDefault
                ? 'Could not load default times. Check your connection.'
                : 'Location not found. Please try a different address.';
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Get Times';
        }
    }

    // --- Initialize MapLibre GL Map ---
    function initMap() {
        const mapEl = document.getElementById('prayer-map');
        if (!mapEl || typeof maplibregl === 'undefined') return;

        // Use OpenFreeMap (open-source, no API key required)
        map = new maplibregl.Map({
            container: 'prayer-map',
            style: 'https://tiles.openfreemap.org/styles/liberty',
            center: [-74.1502, 40.5795], // Staten Island, NY [lng, lat]
            zoom: 13
        });

        // Add navigation controls
        map.addControl(new maplibregl.NavigationControl(), 'top-right');

        // Place default marker at Staten Island immediately (don't rely on API geocoding)
        marker = new maplibregl.Marker({ color: '#c9a84c' })
            .setLngLat([-74.1502, 40.5795])
            .addTo(map);

        // Click on map → reverse geocode label, fetch prayer times with exact click coords
        map.on('click', async function (e) {
            const lat = e.lngLat.lat;
            const lon = e.lngLat.lng;

            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
                const data = await response.json();

                const label = data && data.address
                    ? (data.address.city || data.address.town || data.address.village || data.address.state || data.display_name.split(',')[0])
                    : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

                locationInput.value = label;
                // Pass EXACT click coordinates — no re-geocoding, perfectly accurate
                fetchPrayerTimes(lat, lon, label, false);
            } catch (err) {
                console.error('Reverse geocoding failed', err);
                fetchPrayerTimes(lat, lon, `${lat.toFixed(4)}, ${lon.toFixed(4)}`, false);
            }
        });
    }

    // Initialize Map before fetching default times
    initMap();

    // --- Live Prayer Countdown Timer ---
    function startPrayerCountdown() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }

        const countdownEl = document.getElementById('next-prayer-time');
        if (!countdownEl || !currentTimings) return;

        function update() {
            const now = new Date();
            const currentMins = now.getHours() * 60 + now.getMinutes();
            const currentSecs = now.getSeconds();

            const prayers = [
                { name: 'Fajr', time: currentTimings.Fajr },
                { name: 'Dhuhr', time: currentTimings.Dhuhr },
                { name: 'Asr', time: currentTimings.Asr },
                { name: 'Maghrib', time: currentTimings.Maghrib },
                { name: 'Isha', time: currentTimings.Isha }
            ];

            let nextPrayer = prayers[0]; // Default to Fajr next day
            let isNextDay = true;
            let prayerTimeMins = 0;

            for (let i = 0; i < prayers.length; i++) {
                const pMins = timeToMins(prayers[i].time);

                if (currentMins < pMins || (currentMins === pMins && currentSecs === 0)) {
                    nextPrayer = prayers[i];
                    prayerTimeMins = pMins;
                    isNextDay = false;
                    break;
                }
            }

            // Handle rollover to next day Fajr
            if (isNextDay) {
                prayerTimeMins = (24 * 60) + timeToMins(prayers[0].time);
            }

            // Calculate time difference
            const diffMins = prayerTimeMins - currentMins - 1; // -1 because we track seconds independently
            const diffSecs = 60 - currentSecs;

            const hoursLeft = Math.floor(diffMins / 60);
            const minsLeft = diffMins % 60;
            const secsLeft = diffSecs === 60 ? 0 : diffSecs;

            // Account for edge case right on the minute boundary
            const displayHours = diffSecs === 60 ? hoursLeft + 1 : hoursLeft;
            const displayMins = diffSecs === 60 ? 0 : minsLeft;

            // Format output string
            let timeString = '';
            if (displayHours > 0) timeString += `${displayHours}h `;
            if (displayMins > 0 || displayHours > 0) timeString += `${Math.max(0, displayMins)}m `;
            timeString += `${secsLeft}s`;

            countdownEl.textContent = `${timeString} until ${nextPrayer.name}`;

            // Optional UX: make it red if under 30 minutes
            const popupWrapper = countdownEl.closest('.hero-popup');
            if (displayHours === 0 && displayMins < 30) {
                countdownEl.style.color = 'var(--color-accent)';
                if (popupWrapper) popupWrapper.style.borderColor = 'var(--color-accent)';
            } else {
                countdownEl.style.color = 'var(--text-main)';
                if (popupWrapper) popupWrapper.style.borderColor = 'var(--border-color)';
            }
        }

        update(); // Run immediately right now
        countdownInterval = setInterval(update, 1000); // And tick every second
    }

    function highlightNextPrayer(timings) {
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();

        let activePrayer = 'fajr'; // default fallback for next day
        const prayers = [
            { id: 'fajr', time: timings.Fajr },
            { id: 'dhuhr', time: timings.Dhuhr },
            { id: 'asr', time: timings.Asr },
            { id: 'maghrib', time: timings.Maghrib },
            { id: 'isha', time: timings.Isha }
        ];

        for (let i = 0; i < prayers.length; i++) {
            const pMins = timeToMins(prayers[i].time);

            if (currentMins < pMins) {
                activePrayer = prayers[i].id;
                break;
            }
        }

        // Remove active class from all
        const rows = document.querySelectorAll('.prayer-row[data-prayer]');
        rows.forEach(row => row.classList.remove('active'));

        // Add active class
        const activeRow = document.querySelector(`.prayer-row[data-prayer="${activePrayer}"]`);
        if (activeRow) {
            activeRow.classList.add('active');
        }
    }

    // --- Eid Countdown ---
    async function initEidCountdown() {
        // Fallback approximate dates if API fails (1447 H)
        let eidAlFitr = new Date('2026-03-20T00:00:00');
        let eidAlAdha = new Date('2026-06-16T00:00:00');

        try {
            // Eid al-Fitr = 1 Shawwal (month 10) 1447H
            // Eid al-Adha = 10 Dhul Hijjah (month 12) 1447H
            const [fitrRes, adhaRes] = await Promise.all([
                fetch('https://api.aladhan.com/v1/hToG/1/10/1447'),
                fetch('https://api.aladhan.com/v1/hToG/10/12/1447')
            ]);
            const [fitrData, adhaData] = await Promise.all([fitrRes.json(), adhaRes.json()]);

            const parseDate = (d) => {
                const [dd, mm, yyyy] = d.data.gregorian.date.split('-');
                return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
            };

            if (fitrData.code === 200) eidAlFitr = parseDate(fitrData);
            if (adhaData.code === 200) eidAlAdha = parseDate(adhaData);
        } catch (e) {
            console.warn('Eid API fetch failed, using approximate dates', e);
        }

        const now = new Date();
        let target, name;

        if (eidAlFitr > now) { target = eidAlFitr; name = 'Eid al-Fitr'; }
        else if (eidAlAdha > now) { target = eidAlAdha; name = 'Eid al-Adha'; }
        else {
            target = new Date('2027-03-09T00:00:00'); // approximate next year
            name = 'Eid al-Fitr';
        }

        const labelEl = document.getElementById('eid-label');
        const timerEl = document.getElementById('eid-timer');
        const daysEl = document.getElementById('eid-days');
        const hoursEl = document.getElementById('eid-hours');
        const minsEl = document.getElementById('eid-mins');
        const secsEl = document.getElementById('eid-secs');

        if (!labelEl || !timerEl) return;
        labelEl.textContent = name;

        const pad = (n) => String(n).padStart(2, '0');

        function tick() {
            const diff = target - new Date();
            if (diff <= 0) {
                timerEl.innerHTML = '<span class="eid-mubarak">Eid Mubarak! 🎉</span>';
                return;
            }
            daysEl.textContent = pad(Math.floor(diff / 86400000));
            hoursEl.textContent = pad(Math.floor((diff % 86400000) / 3600000));
            minsEl.textContent = pad(Math.floor((diff % 3600000) / 60000));
            secsEl.textContent = pad(Math.floor((diff % 60000) / 1000));
        }

        tick();
        setInterval(tick, 1000);
    }

    initEidCountdown();


    // Geocode a text address via Nominatim, then fetch prayer times by exact coords
    async function geocodeAndFetch(address) {
        try {
            searchBtn.disabled = true;
            searchBtn.textContent = 'Loading...';
            errorEl.style.display = 'none';

            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`
            );
            const results = await response.json();

            if (!results || results.length === 0) {
                errorEl.style.display = 'block';
                errorEl.textContent = 'Location not found. Please try a different address.';
                searchBtn.disabled = false;
                searchBtn.textContent = 'Get Times';
                return;
            }

            const place = results[0];
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);
            const label = place.display_name;
            fetchPrayerTimes(lat, lon, label, false);

        } catch (err) {
            console.error('Geocoding error:', err);
            errorEl.style.display = 'block';
            errorEl.textContent = 'Could not look up that location. Check your connection.';
            searchBtn.disabled = false;
            searchBtn.textContent = 'Get Times';
        }
    }

    // Initial Fetch — Staten Island default (hard-coded coords, no geocoding needed)
    const DEFAULT_LAT = 40.5795;
    const DEFAULT_LON = -74.1502;
    fetchPrayerTimes(DEFAULT_LAT, DEFAULT_LON, 'Staten Island, NY', true);

    // --- Dynamic Fun Facts ---
    const funFacts = [
        "The word 'Masjid' literally translates to 'place of prostration' in Arabic.",
        "The Quba Mosque in Medina is recognized as the first mosque in Islamic history.",
        "The Alhambra in Spain contains some of the most intricate Islamic architecture in the world.",
        "A minaret is traditionally used to project the call to prayer (Adhan).",
        "The direction of prayer, or Qibla, always faces the Kaaba in Mecca.",
        "The Great Mosque of Djenne in Mali is the largest mud-brick building in the world.",
        "Wudu facilities are universally found in mosques for purification before prayer.",
        "The Mihrab is a semi-circular niche indicating the Qibla wall.",
        "The Minbar is the pulpit where the Imam delivers the Friday sermon (Khutbah).",
        "Islamic geometric patterns represent the infinite nature of the universe.",
        "Mosques do not contain statues or pictures of animate beings.",
        "Calligraphy is heavily utilized as decorative art inside most mosques.",
        "The Prophet's Mosque (Al-Masjid an-Nabawi) was originally built adjacent to his home.",
        "Many historical mosques also served as universities, hospitals, and courts.",
        "The Blue Mosque in Istanbul is famous for its intricate hand-painted blue tiles.",
        "The Sheikh Zayed Grand Mosque in UAE features one of the world's largest hand-knotted carpets.",
        "Faisal Mosque in Pakistan is uniquely designed without traditional domes.",
        "Friday (Jummah) is the congregational prayer day for Muslims globally.",
        "Sadaqah (voluntary charity) boxes are commonly found in most masjids.",
        "The Dome of the Rock in Jerusalem features some of the oldest surviving Islamic mosaics.",
        "The largest mosque in the world is Al-Masjid al-Haram in Mecca.",
        "Hassan II Mosque in Morocco has a minaret that stands 210 meters tall.",
        "In Islamic tradition, building a mosque carries immense ongoing spiritual reward (Sadaqah Jariyah).",
        "Many modern mosques incorporate eco-friendly green technologies.",
        "Mosques act as community centers, providing counseling and community welfare.",
        "During Ramadan, masjids host nightly Tarawih prayers.",
        "I'tikaf is a spiritual retreat commonly performed in mosques during the last 10 days of Ramadan.",
        "The concept of 'Waqf' (endowment) was historically used to fund the construction and upkeep of mosques.",
        "Historically, travel caravans would stop at mosques for safe lodging.",
        "Regardless of social status, all individuals stand shoulder-to-shoulder in prayer inside a masjid."
    ];

    const factText = document.getElementById('fun-fact-text');
    if (factText) {
        let currentFactIndex = 0;

        // Display initial random fact
        currentFactIndex = Math.floor(Math.random() * funFacts.length);
        factText.textContent = funFacts[currentFactIndex];

        setInterval(() => {
            // Fade out
            factText.classList.add('fade-out');

            setTimeout(() => {
                // Update text while hidden
                currentFactIndex = (currentFactIndex + 1) % funFacts.length;
                factText.textContent = funFacts[currentFactIndex];

                // Fade back in
                factText.classList.remove('fade-out');
            }, 500); // Wait for CSS transition (0.5s)
        }, 8000); // Change fact every 8 seconds
    }

    // --- Dynamic Daily Inspiration ---
    const inspirations = [
        "\"Verily, with hardship comes ease.\" (Quran 94:5)",
        "\"He who has in his heart the weight of a mustard seed of pride shall not enter Paradise.\" (Hadith)",
        "\"The best of you are those who have the best manners.\" (Hadith)",
        "\"And He found you lost and guided you.\" (Quran 93:7)",
        "\"A good word is charity.\" (Hadith)",
        "\"So remember Me; I will remember you.\" (Quran 2:152)",
        "\"The strong man is not the good wrestler; the strong man is only the one who controls himself when he is angry.\" (Hadith)",
        "\"Do not lose hope, nor be sad.\" (Quran 3:139)",
        "\"Patience is a pillar of faith.\" (Hadith)",
        "\"And speak to people good words.\" (Quran 2:83)"
    ];

    const inspirationText = document.getElementById('inspiration-text');
    if (inspirationText) {
        let currentInspIndex = 0;

        currentInspIndex = Math.floor(Math.random() * inspirations.length);
        inspirationText.textContent = inspirations[currentInspIndex];

        setInterval(() => {
            inspirationText.classList.add('fade-out');
            setTimeout(() => {
                currentInspIndex = (currentInspIndex + 1) % inspirations.length;
                inspirationText.textContent = inspirations[currentInspIndex];
                inspirationText.classList.remove('fade-out');
            }, 500);
        }, 10000); // Change inspiration every 10 seconds
    }

    // --- Dynamic Upcoming Events ---
    const events = [
        "Friday Jummah @ 1:30 PM",
        "Youth Halaqah Tonight @ 6:00 PM",
        "Community Breakfast this Sunday",
        "Weekly Tafseer Class: Wednesdays @ 7:00 PM",
        "Ask the Imam Q&A: Saturday After Asr"
    ];

    const eventText = document.getElementById('event-text');
    if (eventText) {
        let currentEventIndex = 0;

        eventText.textContent = events[currentEventIndex];

        setInterval(() => {
            eventText.classList.add('fade-out');
            setTimeout(() => {
                currentEventIndex = (currentEventIndex + 1) % events.length;
                eventText.textContent = events[currentEventIndex];
                eventText.classList.remove('fade-out');
            }, 500);
        }, 6000); // Change event every 6 seconds
    }

    // --- Nominatim (OpenStreetMap) Autocomplete ---
    const autocompleteResults = document.getElementById('autocomplete-results');
    let debounceTimer;

    locationInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        // Clear dropdown if input is empty
        if (query.length < 3) {
            autocompleteResults.classList.remove('show');
            autocompleteResults.innerHTML = '';
            return;
        }

        // Debounce to respect 1 request/sec limit
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                // Nominatim API call
                const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`);
                const data = await response.json();

                autocompleteResults.innerHTML = '';

                if (data && data.length > 0) {
                    autocompleteResults.classList.add('show');

                    data.forEach(place => {
                        const li = document.createElement('li');
                        li.className = 'autocomplete-item';
                        li.textContent = place.display_name;

                        li.addEventListener('click', () => {
                            locationInput.value = place.display_name;
                            autocompleteResults.classList.remove('show');
                            // lat/lon already available from Nominatim — skip re-geocoding
                            fetchPrayerTimes(
                                parseFloat(place.lat),
                                parseFloat(place.lon),
                                place.display_name,
                                false
                            );
                        });

                        autocompleteResults.appendChild(li);
                    });
                } else {
                    autocompleteResults.classList.remove('show');
                }
            } catch (err) {
                console.error("Autocomplete fetch error: ", err);
                autocompleteResults.classList.remove('show');
            }
        }, 1000); // 1 second debounce
    });

    // Hide dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!locationInput.contains(e.target) && !autocompleteResults.contains(e.target)) {
            autocompleteResults.classList.remove('show');
        }
    });

    // Search Handlers
    searchBtn.addEventListener('click', () => {
        const val = locationInput.value.trim();
        if (val) {
            geocodeAndFetch(val);
        } else {
            fetchPrayerTimes(DEFAULT_LAT, DEFAULT_LON, 'Staten Island, NY', true);
        }
        autocompleteResults.classList.remove('show');
    });

    // "Use My Location" GPS button
    const gpsBtn = document.getElementById('gps-location-btn');
    if (gpsBtn) {
        gpsBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                errorEl.style.display = 'block';
                errorEl.textContent = 'Geolocation is not supported by your browser.';
                return;
            }
            gpsBtn.textContent = '📡 Locating...';
            gpsBtn.disabled = true;
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    // Reverse-geocode to get a readable label
                    try {
                        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
                        const d = await r.json();
                        const label = d.address
                            ? (d.address.city || d.address.town || d.address.village || d.address.state || 'Your Location')
                            : 'Your Location';
                        locationInput.value = label;
                        fetchPrayerTimes(lat, lon, label, false);
                    } catch {
                        fetchPrayerTimes(lat, lon, 'Your Location', false);
                    }
                    gpsBtn.textContent = '📍 My Location';
                    gpsBtn.disabled = false;
                },
                () => {
                    errorEl.style.display = 'block';
                    errorEl.textContent = 'Could not access your location. Please allow location access and try again.';
                    gpsBtn.textContent = '📍 My Location';
                    gpsBtn.disabled = false;
                }
            );
        });
    }

    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    // --- Mobile Menu Toggle ---
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (mobileMenuToggle && navLinks) {
        mobileMenuToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            mobileMenuToggle.classList.toggle('open');
        });
    }

    // --- Services Modal Logic ---
    const serviceCards = document.querySelectorAll('.service-card[data-modal="true"]');
    const serviceModal = document.getElementById('service-modal');
    const modalCloseBtn = document.getElementById('modal-close');
    const modalIcon = document.getElementById('modal-icon');
    const modalTitle = document.getElementById('modal-title');
    const modalDesc = document.getElementById('modal-desc');

    serviceCards.forEach(card => {
        card.addEventListener('click', () => {
            const title = card.getAttribute('data-title');
            const icon = card.getAttribute('data-icon');
            const desc = card.getAttribute('data-desc');

            if (title && icon && desc) {
                modalIcon.textContent = icon;
                modalTitle.textContent = title;
                modalDesc.innerHTML = desc;
                serviceModal.classList.add('active');
            }
        });
    });

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            serviceModal.classList.remove('active');
        });
    }

    if (serviceModal) {
        serviceModal.addEventListener('click', (e) => {
            if (e.target === serviceModal) {
                serviceModal.classList.remove('active');
            }
        });
    }

    // --- Donate Buttons Logic ---
    const donateButtons = document.querySelectorAll('.donate-amt');
    donateButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all
            donateButtons.forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-secondary');
            });
            // Add active to clicked
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
        });
    });

    // --- Hero Animations on Load ---
    setTimeout(() => {
        const loadElements = document.querySelectorAll('.animate-on-load');
        loadElements.forEach(el => el.classList.add('show'));
    }, 100);

    // --- Typing Effect for Hero ---
    const typingSpan = document.querySelector('.typing-text');
    if (typingSpan) {
        const words = ['Spiritual Home', 'Community Center', 'Place of Peace'];
        let wordIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        let typingDelay = 150;

        function type() {
            const currentWord = words[wordIndex];

            if (isDeleting) {
                typingSpan.textContent = currentWord.substring(0, charIndex - 1);
                charIndex--;
                typingDelay = 50;
            } else {
                typingSpan.textContent = currentWord.substring(0, charIndex + 1);
                charIndex++;
                typingDelay = 150;
            }

            if (!isDeleting && charIndex === currentWord.length) {
                isDeleting = true;
                typingDelay = 2000; // Pause at end of word
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                wordIndex = (wordIndex + 1) % words.length;
                typingDelay = 500; // Pause before typing next word
            }

            setTimeout(type, typingDelay);
        }

        // Start typing effect after the initial animation loads
        setTimeout(type, 1500);
    }

    // --- Scroll Animations ---
    const scrollElements = document.querySelectorAll('.animate-on-scroll');
    const scrollObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('show');
                // Optional: Stop observing once shown
                scrollObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15, // Trigger when 15% visible
        rootMargin: "0px 0px -50px 0px" // Slightly before it reaches the bottom
    });

    scrollElements.forEach(el => scrollObserver.observe(el));

    // --- Custom Cursor & Interactive Shapes Logic ---
    if (window.matchMedia("(pointer: fine)").matches) {
        const cursor = document.querySelector('.custom-cursor');
        const follower = document.querySelector('.custom-cursor-follower');
        const shapes = document.querySelectorAll('.shape');
        const heroSection = document.querySelector('.hero');

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let followerX = mouseX;
        let followerY = mouseY;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        // Smooth hardware-accelerated render loop
        function renderCursor() {
            if (cursor && follower) {
                // Immediate update for primary cursor (0 lag)
                cursor.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%)`;

                // Smooth easing for follower
                followerX += (mouseX - followerX) * 0.15;
                followerY += (mouseY - followerY) * 0.15;
                follower.style.transform = `translate3d(${followerX}px, ${followerY}px, 0) translate(-50%, -50%)`;
            }
            requestAnimationFrame(renderCursor);
        }
        renderCursor();

        // Interactive Bubbles (Parallax repelling effect)
        if (heroSection && shapes.length > 0) {
            heroSection.addEventListener('mousemove', (e) => {
                // Calculate position relative to center of screen -1 to 1
                const x = (e.clientX / window.innerWidth - 0.5) * 2;
                const y = (e.clientY / window.innerHeight - 0.5) * 2;

                shapes.forEach((shape, index) => {
                    const speed = (index + 1) * 25; // Parallax speeds
                    const tx = x * speed;
                    const ty = y * speed;
                    shape.style.setProperty('--tx', `${tx}px`);
                    shape.style.setProperty('--ty', `${ty}px`);
                });
            });

            // Reset shapes when leaving hero section
            heroSection.addEventListener('mouseleave', () => {
                shapes.forEach(shape => {
                    shape.style.setProperty('--tx', `0px`);
                    shape.style.setProperty('--ty', `0px`);
                });
            });
        }

        // Apply active state on hover target elements
        const interactiveElements = document.querySelectorAll('a, button, input, textarea, .service-card, .autocomplete-item');
        if (cursor && follower) {
            interactiveElements.forEach(el => {
                el.addEventListener('mouseenter', () => {
                    cursor.classList.add('active');
                    follower.classList.add('active');
                });
                el.addEventListener('mouseleave', () => {
                    cursor.classList.remove('active');
                    follower.classList.remove('active');
                });
            });
        }
    }

});