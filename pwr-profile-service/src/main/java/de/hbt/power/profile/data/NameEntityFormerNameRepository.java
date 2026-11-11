package de.hbt.power.profile.data;

import de.hbt.power.profile.model.profile.NameEntityType;
import de.hbt.power.profile.model.profile.entries.NameEntity;
import de.hbt.power.profile.model.profile.entries.NameEntityFormerName;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface NameEntityFormerNameRepository extends JpaRepository<NameEntityFormerName, Long> {

    List<NameEntityFormerName> findAllByType(NameEntityType type);

    List<NameEntityFormerName> findAllByNameEntity(NameEntity nameEntity);
}
