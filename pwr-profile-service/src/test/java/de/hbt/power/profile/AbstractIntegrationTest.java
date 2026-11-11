package de.hbt.power.profile;

import de.hbt.power.profile.client.ReportClient;
import de.hbt.power.profile.client.SkillProfileClient;
import de.hbt.power.profile.client.StatisticsClient;
import de.hbt.power.profile.client.ViewProfileClient;
import de.hbt.power.profile.model.skill.SkillCategory;
import org.junit.Before;
import org.mockito.Mockito;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.ResponseEntity;

import static org.mockito.ArgumentMatchers.any;

public class AbstractIntegrationTest {
    @MockBean(name = "skillProfileClient")
    protected SkillProfileClient skillProfileClient;

    @MockBean(name = "viewProfileClient")
    protected ViewProfileClient viewProfileClient;

    @MockBean(name = "statisticsClient")
    protected StatisticsClient statisticsClient;

    @MockBean(name = "reportClient")
    protected ReportClient reportClient;

    @Before
    public void setUp() throws Exception {
    }
}
