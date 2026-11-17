package com.smartcare.backend.repository;

import com.smartcare.backend.entity.FormArchive;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface FormArchiveRepository extends MongoRepository<FormArchive, String> {

    /** 某患者某表单的全部归档，按版本倒序（第一条即当前有效版本） */
    List<FormArchive> findByPidAndFormKeyOrderByVersionDesc(String pid, String formKey);

    /** 某患者的全部归档，按归档时间倒序 */
    List<FormArchive> findByPidOrderByArchivedAtDesc(String pid);
}
