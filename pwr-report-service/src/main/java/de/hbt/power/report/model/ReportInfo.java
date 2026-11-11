package de.hbt.power.report.model;


import de.hbt.power.report.model.view.ViewProfile;

import java.time.LocalDate;

public class ReportInfo {
    public ViewProfile viewProfile;
    public String initials;
    public String name;
    public LocalDate birthDate;
    public ReportTemplate reportTemplate;
}
