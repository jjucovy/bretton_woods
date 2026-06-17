// National UI Components

// This file contains comprehensive national UI components including flag banners, country-specific modal designs, diplomatic agreement cards, and battle report cards with military insignia.

// Flag Banners Component
const FlagBanner = ({ country, flagUrl }) => {
    return (
        <div className="flag-banner">
            <img src={flagUrl} alt={`Flag of ${country}`} />
            <p>{country}</p>
        </div>
    );
};

// Country Specific Modal Design Component
const CountryModal = ({ country, details }) => {
    return (
        <div className="country-modal">
            <h2>{country}</h2>
            <p>{details}</p>
        </div>
    );
};

// Diplomatic Agreement Card Component
const DiplomaticAgreementCard = ({ agreement }) => {
    return (
        <div className="diplomatic-agreement-card">
            <h3>{agreement.title}</h3>
            <p>{agreement.description}</p>
        </div>
    );
};

// Battle Report Card Component
const BattleReportCard = ({ report }) => {
    return (
        <div className="battle-report-card">
            <h3>Battle: {report.battleName}</h3>
            <p>{report.outcome}</p>
            <img src={report.insigniaUrl} alt={`Insignia for ${report.battleName}`} />
        </div>
    );
};

// Components are available as globals via Babel standalone (no ES module export needed)